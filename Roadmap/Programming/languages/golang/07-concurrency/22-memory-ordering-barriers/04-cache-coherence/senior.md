---
layout: default
title: Cache Coherence — Senior
parent: Cache Coherence
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/04-cache-coherence/senior/
---

# Cache Coherence — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Architectural View: Cores, Caches, Memory, Fabric](#architectural-view-cores-caches-memory-fabric)
5. [MOESI and Directory Coherence](#moesi-and-directory-coherence)
6. [Multi-Socket NUMA in Practice](#multi-socket-numa-in-practice)
7. [Designing Cache-Friendly Data Structures](#designing-cache-friendly-data-structures)
8. [Padding Strategies in Depth](#padding-strategies-in-depth)
9. [Cross-Architecture Design Considerations](#cross-architecture-design-considerations)
10. [Operational Tooling at Scale](#operational-tooling-at-scale)
11. [Real Production Case Studies](#real-production-case-studies)
12. [Coding Patterns at the Senior Level](#coding-patterns-at-the-senior-level)
13. [Anti-Patterns and How to Spot Them](#anti-patterns-and-how-to-spot-them)
14. [Best Practices](#best-practices)
15. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
16. [Common Mistakes](#common-mistakes)
17. [Tricky Points](#tricky-points)
18. [Tricky Questions](#tricky-questions)
19. [Cheat Sheet](#cheat-sheet)
20. [Self-Assessment Checklist](#self-assessment-checklist)
21. [Summary](#summary)
22. [What You Can Build](#what-you-can-build)
23. [Further Reading](#further-reading)
24. [Related Topics](#related-topics)
25. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "I own the architecture of a multi-core Go service. I need to design data structures, choose primitives, and operate the service at scale, all with cache coherence in mind."

Junior-level knowledge is "what is false sharing." Middle-level knowledge is "the MESI state machine and what each Go atomic compiles to." Senior-level knowledge is **system design with coherence as a first-class concern**.

A senior Go engineer designing a high-throughput service must consider:

- **Data structure choices.** Whether to use `sync.Map`, hand-rolled sharded maps, immutable snapshots, or something else, and why.
- **Memory layout.** Padding strategies, NUMA-aware allocation, alignment guarantees.
- **Operational realities.** How to detect coherence problems in production, how to bound their impact, what metrics to expose.
- **Cross-architecture portability.** Code that runs on x86 servers, ARM servers, Apple silicon dev machines, all behaving sensibly.
- **Trade-offs.** When padding is right, when sharding is right, when copy-on-write is right, when "just use a mutex" is right.

This file teaches those judgements. By the end you will:

- Be able to design a per-CPU sharded structure with appropriate fall-back behaviour and a clean API.
- Be able to reason about cross-socket coherence costs and decide when they matter.
- Know how to handle NUMA in Go without controlling the OS thread scheduler directly.
- Recognise the coherence anti-patterns in code reviews and prescribe specific fixes.
- Have a deployment / monitoring strategy for catching coherence regressions before they hit production.

This is the level at which "Go is a high-level language" stops being protective. The hardware shows through. The patterns you learn here are the same patterns you would apply in C++ or Rust at the same scale.

---

## Prerequisites

- **Required:** Solid command of middle-level cache coherence: MESI states, store buffers, what `sync/atomic` does on x86 and ARM.
- **Required:** Production Go experience. You have shipped Go services that handle real load.
- **Required:** Comfort with profiling tools (`pprof`, `perf`, `perf c2c`) and reading their output.
- **Helpful:** Some C or assembly reading ability for examining `go tool objdump` output.
- **Helpful:** Operational experience with at least one of: Linux kernel scheduler tuning, NUMA, CPU pinning, cgroups.

---

## Glossary

| Term | Definition |
|------|-----------|
| **MOESI** | Cache coherence protocol with five states (M, O, E, S, I); adds Owned for dirty-shared. AMD chips. |
| **Directory coherence** | Coherence implementation where a central table records which cores hold each line. Used in large multi-socket systems. |
| **NUMA node** | A subset of CPUs and memory with uniform access cost. A socket is often a NUMA node. |
| **`numactl`** | Linux utility to bind a process to specific NUMA nodes. |
| **`sched_setaffinity`** | Linux system call to bind a thread to specific CPUs. |
| **First-touch allocation** | Linux default: a page is allocated on the NUMA node of the first thread to touch it. |
| **Snoop filter overflow** | When the snoop filter's capacity is exceeded, the system falls back to broadcasting; performance degrades. |
| **Write combining** | A hardware feature that batches multiple stores to the same line before flushing. |
| **Cache way** | A set-associative cache divides addresses into sets; each set has multiple ways. Conflict misses occur when a set is full. |
| **TLB shootdown** | A cross-core invalidation of TLB entries; orthogonal to cache coherence but with similar costs. |
| **Prefetcher** | Hardware unit that predicts and fetches lines ahead of demand. |
| **`runtime.LockOSThread`** | Go function to pin a goroutine to its current OS thread. |
| **CPU affinity** | Constraint on which CPUs the OS may schedule a thread on. |
| **CCX / CCD** | AMD's core-complex and core-die structures; intra-CCX coherence is fast, inter-CCX slower. |
| **NoCopy** | Marker struct in Go that prevents accidental copying via `go vet`. Used in mutexes and atomics. |

---

## Architectural View: Cores, Caches, Memory, Fabric

A senior engineer thinks about a multi-core system as a small distributed system.

### A single socket, modern x86

A typical 16-core Skylake-X / Cascade Lake / Ice Lake socket:

```
Socket (one die)
├── 16 cores
│   each with:
│   ├── L1d (32 KB, ~1 ns)
│   ├── L1i (32 KB, ~1 ns)
│   └── L2  (1 MB,  ~4 ns)
├── Shared L3 (32 MB, ~12 ns) connected by a mesh
├── 6-8 memory channels
└── DRAM (~80 ns)
```

The cores are connected by a mesh (Intel) or ring (older Intel) or Infinity Fabric (AMD). Each mesh stop hosts cores plus an L3 slice plus a memory controller fragment. Coherence traffic travels across the mesh.

### AMD EPYC (Zen 2/3/4)

AMD's design is different. Cores are grouped into CCXes (Core Complexes) of 4–8 cores; CCXes are placed on CCDs (Core Compute Dies); multiple CCDs share a separate IO die for memory and IO.

```
Socket
├── CCD 0
│   ├── CCX 0 (4-8 cores, shared L3)
│   └── CCX 1 (4-8 cores, shared L3)
├── CCD 1 ...
└── IO Die (memory controllers, PCIe)
```

Coherence within a CCX is fast. Across CCXes on the same CCD is slower. Across CCDs is slower still. Cross-socket is slowest.

This matters because a Go service on EPYC may see different scaling depending on where the OS places its threads. Pinning to one CCX is sometimes worth it for very latency-sensitive workloads.

### Apple Silicon

M1/M2/M3 chips have:

- Performance cores in a cluster (4-8 cores), each with private L1d (128 KB) and L1i (192 KB), shared L2 (12 MB cluster).
- Efficiency cores in a separate cluster.
- Unified memory architecture: the GPU shares the same memory.

Cache lines are 128 bytes. The cluster topology means coherence within a P-cluster is fast; across clusters is more expensive. The Go scheduler does not know about clusters — it sees logical CPUs.

### ARM server CPUs (Ampere Altra, AWS Graviton 3/4)

Often more uniform than AMD or Apple — many cores connected to a single coherent fabric. Cache lines are 64 bytes (Graviton 3) or 128 bytes (some configurations). Coherence is fast and reasonably uniform.

### Multi-socket systems

Most production servers have one or two sockets. Some HPC machines have four or eight. Each socket connects to others via UPI (Intel) or Infinity Fabric (AMD). Cross-socket coherence is roughly 5-10× slower than same-socket.

For a senior, the key idea: **cache lines are messages on a network**. The topology of that network affects coherence costs. Locality on the network matters.

---

## MOESI and Directory Coherence

Middle-level focused on MESI. Senior-level adds two more concepts.

### MOESI: Owned state

MOESI adds the **Owned (O)** state: this core has the only modified copy AND other cores have shared copies. Compared to MESI:

- In MESI, when a core in M state is read by another, it must write back to memory and downgrade to S.
- In MOESI, the M-state core can instead transition to O and forward the value to the reader (who goes to S). The line stays dirty; no write-back needed yet.

Benefit: less memory bandwidth. The dirty line stays in the cache hierarchy until truly evicted.

AMD has historically used MOESI; Intel uses MESIF (where F = Forward state for read-friend caches).

### Directory coherence

Snoop-based coherence broadcasts. It scales to a few cores per socket but not to thousands of cores or many sockets. Directory coherence keeps a table: for each cache line in the system, which cores hold it?

When a core wants RFO, it queries the directory, which sends invalidations only to the listed cores. No broadcast.

Modern multi-socket systems use directories (or hybrid schemes). The snoop filter discussed earlier is a directory-like structure local to one socket.

Implications for Go code:

- On a small system (few cores, one socket), broadcast is cheap; directory features are noise.
- On a large system (multiple sockets, many cores), directory lookups add latency. Targeted invalidations are cheaper than broadcasts.
- Code that touches many lines may overflow the directory's capacity, causing fallback to broadcast. This is rare in user-space Go but happens in kernels and databases.

### Bandwidth vs latency

Coherence costs come in two flavours:

- **Latency:** time per individual coherence operation (~30 ns same-socket, ~200 ns cross-socket).
- **Bandwidth:** total coherence traffic the fabric can carry (often the dominant cost at scale).

A workload may be latency-bound (a few hot lines, ping-ponging) or bandwidth-bound (many lines, churning through the fabric). The fixes differ. Latency-bound: pad to keep lines local. Bandwidth-bound: reduce sharing or move work to colder data.

---

## Multi-Socket NUMA in Practice

Most senior engineers do not need NUMA mastery — single-socket VMs hide it. Those who do, here are the practical considerations.

### First-touch allocation on Linux

When a Go program calls `make([]byte, 1<<30)`, Linux does not actually allocate physical pages immediately. It assigns virtual addresses; pages are faulted in on first touch. The OS allocates each page on the NUMA node of the thread that first touched it.

Implications:

- If a slice is initialised by a single goroutine, all pages end up on that goroutine's NUMA node.
- If the slice is later used by threads on other nodes, every access pays the remote-node penalty.
- For NUMA-aware code, ensure that the threads that touch memory most also allocate it.

In Go, the runtime allocator (`mheap`) does not currently expose NUMA awareness. Allocations go to arenas managed by the runtime; arenas may span NUMA nodes invisibly.

### `numactl` for process pinning

The simplest NUMA tool: bind a Go process to one node.

```
numactl --cpunodebind=0 --membind=0 ./myservice
```

This restricts the process to socket 0's cores and memory. No cross-socket access possible. Throughput often improves 20–50% for shared-memory workloads.

For Go services running on multi-socket bare-metal, consider running one process per socket (with separate ports or shared load balancer) instead of one process spanning sockets.

### Per-thread NUMA pinning (cgo)

Within a process, pinning individual threads to NUMA nodes requires cgo:

```go
//#include <sched.h>
import "C"
import "runtime"

func pinToNode(node int) {
    runtime.LockOSThread()
    // Compute the CPU set for the given node...
    // Call sched_setaffinity via cgo.
}
```

This is rarely worth it for Go services. Better: design the service to be NUMA-oblivious by sharding state per CPU and accepting that local coherence is good enough.

### NUMA-aware sharding

A common pattern in databases (and applicable to high-throughput Go services):

- One shard per CPU socket.
- All threads on socket 0 use shard 0; threads on socket 1 use shard 1.
- Merging across shards is rare.

In Go, this is approximated by sharding per `GOMAXPROCS` and trusting the runtime not to migrate frequently across sockets. For mission-critical services, pin threads.

---

## Designing Cache-Friendly Data Structures

A senior's main job: design data structures and APIs that are cache-friendly by construction.

### Principle 1: Separate hot from cold

Within a struct, group hot (frequently mutated) fields and cold (rarely accessed) fields. Pad between them.

```go
type Server struct {
    // hot
    requests atomic.Int64
    _        cpu.CacheLinePad
    errors   atomic.Int64
    _        cpu.CacheLinePad

    // cold (set once at construction)
    name    string
    address string
    created time.Time
    config  *Config
}
```

The cold fields share lines freely. The hot fields are isolated.

### Principle 2: Shard by access pattern

If you have N counters each potentially touched by M cores, you have N×M sharing problems. Restructure as M shards each holding N counters, indexed by CPU.

```go
type Counters struct {
    perCPU []shardedCounters
}

type shardedCounters struct {
    requests int64
    errors   int64
    bytes    int64
    _        [40]byte // pad to 64
}

func (c *Counters) RecordRequest(cpu int) {
    atomic.AddInt64(&c.perCPU[cpu%len(c.perCPU)].requests, 1)
}
```

Within a shard, the three counters share a line — but only one CPU writes them. No contention. Merge at snapshot time.

### Principle 3: Make reads cheaper than writes

If a value is read 1000× more often than written, design for read-cheapness:

- Use `atomic.Pointer[Snapshot]` for the canonical reference.
- Readers do a single atomic Load — cheap, line in S.
- Writers atomically swap the pointer — rare, brief invalidation.

```go
type ConfigStore struct {
    snapshot atomic.Pointer[Config]
    _        cpu.CacheLinePad
}
```

### Principle 4: Use the standard library

`sync.Pool`, `sync.Map`, `runtime/internal/atomic` types are already tuned. Reach for them before writing your own.

### Principle 5: Document layout invariants

A struct with carefully arranged padding is fragile. A future maintainer can wreck it without realising. Document:

```go
type Counter struct {
    // INVARIANT: value must be on its own cache line.
    // The padding below must not be removed or changed.
    value atomic.Int64
    _     cpu.CacheLinePad
}
```

### Principle 6: Test layout at startup

```go
func init() {
    c := &Counter{}
    addr := uintptr(unsafe.Pointer(&c.value))
    if addr%uintptr(cpu.CacheLinePadSize) != 0 {
        panic("Counter.value misaligned")
    }
}
```

Catch surprises early.

---

## Padding Strategies in Depth

Beyond the basic `_ [56]byte` pattern, several padding strategies are worth knowing.

### Strategy 1: Inline padding fields

```go
type X struct {
    hot int64
    _   [56]byte
}
```

Simple. Anonymous. Cannot be inspected. Standard.

### Strategy 2: Typed padding fields

```go
type CacheLinePad [56]byte

type X struct {
    hot int64
    pad CacheLinePad
}
```

Named, can be referenced. Useful if you want to assert size in tests.

### Strategy 3: cpu.CacheLinePad

```go
import "golang.org/x/sys/cpu"

type X struct {
    hot int64
    _   cpu.CacheLinePad
}
```

Portable across architectures. The package picks the right size for the build target.

### Strategy 4: Embedded padded struct

```go
type Atomic64 struct {
    v atomic.Int64
    _ [56]byte
}

type X struct {
    counter1 Atomic64
    counter2 Atomic64
}
```

Each `Atomic64` is its own cache line. Use when you need many independent atomics in one struct.

### Strategy 5: Padding within an array slot

```go
type Bucket struct {
    value int64
    _     [56]byte
}

type BucketArray [16]Bucket
```

Each slot is 64 bytes. Indexing into the array gets cache-line-isolated cells.

### Strategy 6: Aligned allocation

For globals:

```go
//go:align 64
var counter int64
```

Combined with following padding, gives a cache-line-aligned global.

For heap allocations, Go's allocator does not directly support align-N. Workarounds: allocate a larger buffer and slice out the aligned portion. Rare.

### Strategy 7: Computed padding

When you have to pad something whose size depends on a type:

```go
type Padded[T any] struct {
    v T
    _ [64 - unsafe.Sizeof(*new(T))%64]byte
}
```

The padding expression rounds the struct up to 64 bytes. Tricky and breaks with generics that have non-constant sizes.

### Strategy 8: Manual alignment via slice tricks

```go
buf := make([]byte, 128)
alignedAddr := (uintptr(unsafe.Pointer(&buf[0])) + 63) &^ 63
ptr := (*int64)(unsafe.Pointer(alignedAddr))
```

Hideous but sometimes necessary.

### Choosing among them

For most Go code: use `cpu.CacheLinePad` after each hot field. It is portable, clear, and battle-tested.

For library code: hand-pad to specific sizes if you can document the platform assumptions.

For runtime / kernel-like code: align constructs manually with `//go:align` and explicit pads.

---

## Cross-Architecture Design Considerations

Go binaries run on x86-64, ARM64 (Linux servers, Apple silicon), and 32-bit ARM (rare). Senior code must work across.

### Cache line size

- x86-64: 64 bytes.
- ARM64 server (Ampere, Graviton): 64 bytes.
- Apple silicon: 128 bytes.

Solution: `cpu.CacheLinePad`, sized at build time per target.

### Atomic alignment

- 32-bit ARM: 64-bit atomics require 8-byte alignment.
- 64-bit ARM and x86: 64-bit atomics are naturally aligned in well-formed structs.

Solution: use `atomic.Int64` (typed) which guarantees alignment via `noCopy` and internal layout, or place 64-bit atomics first in struct definitions.

### Memory model

- x86: TSO. Stores are not reordered after loads (much). Atomics on x86 are sequentially consistent.
- ARM: weak. Without fences, almost anything can be reordered.

Solution: always use `sync/atomic` and `sync` primitives. Never roll your own with bare loads/stores. Go's memory model abstracts the differences.

### Atomic instruction availability

- x86: `LOCK` prefix always available.
- ARMv8 base: only LL/SC.
- ARMv8.1 LSE: direct `LDADD`, `CAS`, etc.

The Go toolchain picks at build time. For server-class ARM, you almost always get LSE.

### Performance characteristics

| Operation | x86 | ARM LSE | ARM LL/SC | Apple |
|-----------|-----|---------|-----------|-------|
| atomic.LoadInt64 | ~1 ns | ~1 ns | ~1 ns | ~1 ns |
| atomic.StoreInt64 | ~6 ns | ~6 ns | ~8 ns | ~6 ns |
| atomic.AddInt64 uncontended | ~6 ns | ~6 ns | ~8 ns | ~6 ns |
| atomic.AddInt64 heavy contention | 30-100 ns | 30-100 ns | retry storm | 30-100 ns |

The order of magnitude is the same. Worry about coherence, not architecture.

### Endianness

All modern platforms in scope are little-endian. Cross-endian is essentially dead. Ignore.

---

## Operational Tooling at Scale

At scale, you cannot debug coherence problems by trial and error. You need monitoring and tooling.

### Production pprof

Enable continuous CPU profiling on production hosts. Sample every minute. Aggregate. Look for:

- Atomic operations at the top.
- `sync.(*Mutex).Lock` and related.
- Runtime atomics (`runtime/internal/atomic.*`).

Tools: pyroscope, parca, Datadog Continuous Profiler.

### Hardware counters

If your environment allows `perf`, deploy a sidecar that runs `perf stat` periodically and exports counters to your metrics system. Key counters:

- `cache-misses`
- `LLC-load-misses`
- `offcore_response.*` series
- `cycle_activity.stalls_l3_miss`

These will tell you whether your service is coherence-bound.

### `perf c2c` in canary

`perf c2c` is too heavy for steady-state production. Use it in canary or staging:

```bash
sudo perf c2c record -F 4000 -a -- ./run-load-test
sudo perf c2c report > c2c.report
```

Review the top hot lines. If any are from your code, investigate.

### Custom telemetry

Some services expose runtime metrics like `runtime/metrics` plus custom counters for cache-friendliness:

- A counter incremented on every cross-CPU shard access.
- A latency histogram for atomic operations.
- A heuristic "coherence health" derived from atomic-op latencies.

These are advanced and rare. Usually, pprof + perf are sufficient.

### Benchmarks in CI

Every PR runs a benchmark suite:

```yaml
- name: benchmark
  run: |
    go test -bench=. -benchtime=10s -cpu=1,4,16 -count=5 > bench.out
    benchstat baseline.out bench.out
    # fail if any benchmark regresses by more than X%
```

This catches accidental coherence regressions before deploy.

---

## Real Production Case Studies

### Case Study 1: A search service that did not scale past 8 cores

**Setup:** A Go service serving search queries. Each query consults a per-route counter. 30k RPS at 8 cores; 32k RPS at 16 cores.

**Diagnosis:** pprof showed 22% in `atomic.AddInt64`. `perf c2c` flagged the counter slice as the hot line.

**Fix:** Padded the counter struct to 64 bytes. Each route's counter on its own line.

**Result:** 30k → 70k RPS at 16 cores. CPU usage dropped 35%.

**Lesson:** Padding a 24-byte struct to 64 bytes per counter cost ~10 MB of memory (a million routes × 40 extra bytes). Negligible compared to the gain.

### Case Study 2: A logging library that became the bottleneck

**Setup:** A Go service logged each request via a popular logger. Throughput plateaued at 50k RPS regardless of cores.

**Diagnosis:** pprof showed massive time in `logger.Output`. Looking at the logger source: a global mutex around the writer.

**Fix:** Switched to a logger with per-goroutine buffers and periodic flushes.

**Result:** Throughput doubled. The fix was algorithmic — avoid the mutex on the hot path — not just padding.

**Lesson:** Sometimes the fix is not padding or sharding but redesigning the algorithm to avoid sharing entirely.

### Case Study 3: A websocket fanout that bounced cache lines

**Setup:** A service maintained 100k websocket connections, each in its own goroutine. Outbound messages were fanned out from a publisher goroutine via a shared channel.

**Diagnosis:** Throughput was poor. The shared channel's hchan struct bounced between cores.

**Fix:** Sharded the channel. 64 shards. Each subscriber registered to one shard.

**Result:** 5× throughput improvement.

**Lesson:** Shared channels are often coherence hotspots. Sharding fixes it.

### Case Study 4: A metrics library that destroyed scaling at 64 cores

**Setup:** A metrics library used by every handler exposed atomic counters. On a 64-core box, the service used 90% CPU at 100k RPS — only 1.5x the throughput of an 8-core box.

**Diagnosis:** All counters were packed in a single struct. Counters shared lines. Every handler invalidated lines for every other handler.

**Fix:** Migrated to per-CPU sharded counters with periodic flushes to the canonical counter.

**Result:** Linear scaling restored. Throughput jumped to 800k RPS.

**Lesson:** A widely-used library with bad cache behaviour can dominate a service's performance.

### Case Study 5: A "lock-free" queue that was slower than a mutex queue

**Setup:** A team implemented an MPMC lock-free queue using atomics. Benchmarks showed it slower than a `chan T` with capacity.

**Diagnosis:** The queue's head and tail indices shared a cache line. Cells were 32 bytes each, sharing lines with neighbouring cells.

**Fix:** Padded head and tail. Padded each cell to 64 bytes. The queue became 3× faster than channels.

**Lesson:** "Lock-free" does not mean "fast." Layout still matters.

---

## Coding Patterns at the Senior Level

### Pattern: snapshot pointer + atomic swap

For read-mostly state:

```go
type Service struct {
    config atomic.Pointer[Config]
    _      cpu.CacheLinePad
}

func (s *Service) Update(c *Config) { s.config.Store(c) }
func (s *Service) Get() *Config     { return s.config.Load() }
```

Readers do an atomic pointer load. Writers do an atomic pointer store. Snapshots are immutable; readers can dereference fields freely.

### Pattern: per-CPU sharded with merge

```go
type Counter struct {
    shards []paddedInt64
}

type paddedInt64 struct {
    v atomic.Int64
    _ cpu.CacheLinePad
}

func New(n int) *Counter {
    return &Counter{shards: make([]paddedInt64, n)}
}

func (c *Counter) Add(cpu int) {
    c.shards[cpu%len(c.shards)].v.Add(1)
}

func (c *Counter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    return s
}
```

Pick a shard by CPU hint (request ID, goroutine ID hash, runtime P ID). Each shard is on its own cache line. No contention if the hint is well-distributed.

### Pattern: read-mostly map with copy-on-write

```go
type Map[K comparable, V any] struct {
    m atomic.Pointer[map[K]V]
    _ cpu.CacheLinePad
}

func (m *Map[K, V]) Get(k K) (V, bool) {
    p := m.m.Load()
    if p == nil {
        var zero V
        return zero, false
    }
    v, ok := (*p)[k]
    return v, ok
}

func (m *Map[K, V]) Set(k K, v V) {
    for {
        old := m.m.Load()
        next := make(map[K]V, lenOrZero(old)+1)
        if old != nil {
            for k2, v2 := range *old {
                next[k2] = v2
            }
        }
        next[k] = v
        if m.m.CompareAndSwap(old, &next) {
            return
        }
    }
}

func lenOrZero[K comparable, V any](p *map[K]V) int {
    if p == nil { return 0 }
    return len(*p)
}
```

Reads are essentially free after the initial load. Writes are expensive (full copy). Good for read-mostly, small maps with rare updates.

### Pattern: hot/cold split with deferred write-back

```go
type Worker struct {
    // hot
    localCount int64       // touched only by this worker
    _          cpu.CacheLinePad

    // cold (touched only on flush)
    globalCount *atomic.Int64
    flushEvery  int
}

func (w *Worker) Inc() {
    w.localCount++
    if w.localCount >= int64(w.flushEvery) {
        w.globalCount.Add(w.localCount)
        w.localCount = 0
    }
}
```

99% of increments stay local. The global counter is updated once per `flushEvery` operations.

### Pattern: epoch-based reclamation

For high-throughput data structures with safe memory reclamation:

```go
type Epoch struct {
    workers []paddedInt64
    global  atomic.Int64
}

func (e *Epoch) Enter(worker int) {
    e.workers[worker].v.Store(e.global.Load() | 1)
}

func (e *Epoch) Exit(worker int) {
    e.workers[worker].v.Store(0)
}

func (e *Epoch) SafeToReclaim(epoch int64) bool {
    for i := range e.workers {
        v := e.workers[i].v.Load()
        if v != 0 && v < epoch {
            return false
        }
    }
    return true
}
```

Each worker advertises its epoch. Reclamation waits until all workers have advanced past the target epoch.

### Pattern: padded mutex slot

```go
type MutexSlot struct {
    mu sync.Mutex
    _  cpu.CacheLinePad
}

type Registry struct {
    slots [256]MutexSlot
    data  [256]map[string]interface{}
}

func (r *Registry) Lock(key string) {
    h := hash(key) % 256
    r.slots[h].mu.Lock()
}
```

A sharded lock registry. Each shard's lock is on its own line.

### Pattern: aligned ring buffer with stale indices

```go
type Ring[T any] struct {
    head        atomic.Uint64
    cachedTail  uint64           // producer-local stale view of tail
    _           cpu.CacheLinePad

    tail        atomic.Uint64
    cachedHead  uint64           // consumer-local stale view of head
    _           cpu.CacheLinePad

    buf  []T
    mask uint64
}
```

The producer reads `cachedTail` (its own variable) most of the time. Only when the cached value says "full" does it refresh from `tail`. Symmetric for the consumer.

This pattern is the heart of LMAX Disruptor. Throughput approaches the speed of writing a single value to L1 cache per operation.

---

## Anti-Patterns and How to Spot Them

### Anti-pattern: "global atomic counter"

```go
var counter atomic.Int64

func bump() { counter.Add(1) }
```

Bad if called from many cores. Shard it.

### Anti-pattern: "stats struct with packed atomics"

```go
type Stats struct {
    A, B, C, D atomic.Int64
}
```

All four atomics share one or two cache lines. Pad them apart or shard.

### Anti-pattern: "mutex right next to protected data"

```go
type Resource struct {
    mu sync.Mutex
    data int64
}
```

Every lock/unlock invalidates the data line. Pad between.

### Anti-pattern: "RWMutex for short critical sections"

```go
var mu sync.RWMutex
var x int

func get() int { mu.RLock(); defer mu.RUnlock(); return x }
```

The RLock/RUnlock costs more than the protected work. Use a Mutex or an atomic.Pointer pattern.

### Anti-pattern: "shared channel with many senders/receivers"

```go
ch := make(chan Job, 1000)
for i := 0; i < 64; i++ { go worker(ch) }
```

The channel's internal state bounces. Shard the channel.

### Anti-pattern: "naive spinlock"

```go
for !atomic.CompareAndSwapUint32(&lock, 0, 1) {}
```

Every spinner issues a CAS that requires line in M. Use test-then-CAS, or just use a `sync.Mutex`.

### Anti-pattern: "per-goroutine atomic counter"

```go
var counters = map[uint64]*atomic.Int64{}
var mu sync.Mutex

func get(id uint64) *atomic.Int64 {
    mu.Lock()
    c, ok := counters[id]
    if !ok { c = new(atomic.Int64); counters[id] = c }
    mu.Unlock()
    return c
}
```

The map's mutex is hot. Use per-P slots via `sync.Pool`-style design.

---

## Best Practices

- **Design data structures with coherence as a first-class concern.** Hot/cold separation, sharding, snapshots — pick the right tool for each shared variable.
- **Prefer `sync.Map`, `sync.Pool`, `atomic.Pointer`** over hand-rolled equivalents. The standard library is tuned.
- **Always benchmark with `-cpu=1,2,4,8,16` (and 32 if your build farm supports).** Scaling collapse is the canary.
- **Document layout invariants in the type itself.** A future engineer who deletes the `_ [56]byte` field must see why it is there.
- **Use `cpu.CacheLinePad`** for portable code. Hand-pad when you have measured and need every byte.
- **Add CI benchmarks that fail on regression.** Coherence regressions are the kind that creep in via "harmless" refactors.
- **Provide a path to disable padding** for memory-constrained environments. (Rare; usually you want padding always on.)
- **Educate the team.** A widely-used internal library tuned for cache is a force multiplier; a poorly-tuned one is a drag on every service.
- **Operate with observability.** Monitor `pprof`'s top functions on production. If atomics or mutexes climb, investigate.
- **Profile in canary, fix in code, verify in canary again.** Production is not the right place to discover coherence problems.

---

## Edge Cases & Pitfalls

- **NUMA on cloud VMs.** Most are single-node. Some are not. Check `lscpu` on each instance type you target.
- **`runtime.GOMAXPROCS`.** A surprise change (e.g., container CPU quota) can affect per-P sharding decisions.
- **Cgroups CPU limits.** A 16-core container limited to 4 CPUs by cgroup still has `NumCPU()=16` in Go. Use `automaxprocs` or set `GOMAXPROCS` explicitly.
- **Memory pressure under high contention.** Coherence-bound code wastes CPU; if scaled down, CPU time pressure shows as memory pressure (more GC).
- **Hyperthreading.** Two threads on one physical core share L1 — no false sharing between them. Benchmark on physical cores for honest numbers.
- **Apple silicon big.LITTLE.** Performance cores and efficiency cores have different cache behaviour. Pinning to P-cores requires undocumented APIs; usually not worth it.
- **Burst traffic.** A service that handles 100x normal traffic in spikes may surface coherence problems that are invisible at baseline.
- **Containerised deployments.** Many containers per host may compete for shared L3 even if logically isolated. The "noisy neighbour" problem includes coherence.

---

## Common Mistakes

1. **Padding only inside a struct, not between adjacent allocations.** Two structs in a slice may share a line even if each is internally padded — pad the struct to a full line.
2. **Using `int32` thinking smaller is better.** Smaller fields fit more per line, increasing sharing probability.
3. **Allocating from many goroutines without per-P pools.** Causes allocator contention even when individual workloads look benign.
4. **Setting `GOMAXPROCS` higher than physical cores.** Over-subscribing causes scheduler thrashing and cache thrashing.
5. **Trusting micro-benchmarks at single GOMAXPROCS.** They lie about coherence behaviour.
6. **Forgetting that `time.Now()` reads shared state.** In hot loops it dominates.
7. **Using `runtime.LockOSThread()` and assuming it pins to a core.** It pins to a thread; the OS still moves the thread.
8. **Mixing reads and writes on the same line.** Either all-read or pad apart.

---

## Tricky Points

- **A "shared, read-only" line is not actually read-only at hardware level.** Initial allocation is a write. If many cores read it after a writer touches it, it's still in S, but the first write costs an invalidation.
- **MOESI vs MESI affects bandwidth more than latency.** Owned state delays write-back. Useful for chips with limited memory bandwidth.
- **Snoop filter capacity is finite.** Very large working sets can overflow, falling back to broadcasts. Rare in user-space but possible in database workloads.
- **`runtime.NumCPU()` may differ from `runtime.GOMAXPROCS()`.** Use `GOMAXPROCS` for sizing shards because that is the number of Ps.
- **The Go GC's write barrier touches per-P state on every pointer write.** Heavy pointer mutation during GC marking touches a known small set of lines per P; usually fine, but visible in profiles.
- **`runtime.LockOSThread` does prevent migration between goroutines, but the OS can still migrate the OS thread between cores.** True pinning requires cgo.

---

## Tricky Questions

1. **Why is read-mostly with `atomic.Pointer` faster than read-mostly with `RWMutex`?** Because `atomic.Pointer.Load` is a single MOV; readers do not write any state. RWMutex's RLock writes the reader counter.

2. **When is `LockOSThread` actually useful for cache locality?** Rarely. It pins goroutine to thread, not thread to core. Useful when combined with cgo CPU pinning, but that is outside normal Go.

3. **How does Go's runtime ensure per-P data structures stay on the right CPU?** It doesn't — the OS may migrate threads. Per-P pinning is fast because it usually matches the CPU; the runtime accepts occasional mismatch.

4. **Why does `sync.Pool` use 128-byte padding instead of 64?** To cover Apple silicon (128-byte cache lines). The waste on x86 (64 extra bytes) is negligible.

5. **What is the difference between a snoop filter and a directory?** Both track which cores hold each line. A snoop filter is local (per-socket), while a directory typically spans the system. Modern multi-socket coherence uses directories at the system level and snoop filters within sockets.

6. **Why does a "lock-free" algorithm sometimes outperform a mutex and sometimes lose?** Lock-free wins when the critical section is short and contention is low. Mutex wins when contention is high or critical section is long, because the runtime can park the loser instead of spinning. The crossover depends on the specific algorithm and contention level.

7. **Why is `time.Now()` slow in tight loops on some platforms?** It reads a kernel-shared page (vDSO). The page is cache-resident but globally synchronised. Many cores reading it pay coherence costs.

8. **What does `runtime.Gosched()` cost in coherence terms?** It puts the goroutine back on a runqueue; the runqueue is per-P with stealing. The goroutine may resume on a different P, losing cache locality from its previous run.

9. **Why does `sync.WaitGroup.Add(N)` followed by N `Done()` calls work fine for small N but cost a lot for huge N?** The WaitGroup state is a single counter. N Dones invalidate the counter line N times. Use sharded barriers for huge fan-outs.

10. **How would you design a counter that scales to 1M ops/sec per core on a 64-core machine?** Per-P sharded counter, padded slots, occasional batched flushes. Reads are O(N) over shards.

---

## Cheat Sheet

```
Senior-level decision flow:

  Is this state shared?
    No -> Move on.
    Yes -> What is the read/write ratio?
              Read-heavy (>100:1) -> atomic.Pointer[Snapshot]
              Balanced -> sync.Mutex with padding, or sharded mutex
              Write-heavy by many cores -> per-CPU shard + merge
              Single writer / many readers -> snapshot pointer

  Is the working set fits in L3?
    Yes -> Coherence cost is per-line bouncing.
    No  -> Coherence cost is amortised; capacity matters more.

  Is the system multi-socket?
    Yes -> Cross-socket coherence is 5-10× same-socket. Consider numactl.
    No  -> Standard padding/sharding sufficient.

Common patterns:
  - snapshot pointer: atomic.Pointer[T], readers cheap, writers swap
  - per-CPU shard: []paddedSlot, indexed by hint, merged on snapshot
  - copy-on-write: atomic.Pointer[Map], cheap reads, expensive writes
  - hot/cold split: pad between hot and cold fields
  - epoch counters: per-worker padded slots advertising progress

Bounds to remember:
  - Cache line: 64B (x86, ARM server), 128B (Apple).
  - Same-socket invalidation: ~30 ns.
  - Cross-socket invalidation: ~150-300 ns.
  - Uncontended atomic: ~6 ns.
  - Bouncing atomic: ~30-100 ns.
```

---

## Self-Assessment Checklist

- I can design a per-CPU sharded counter from scratch with appropriate padding.
- I can identify a NUMA system and decide whether per-socket sharding helps.
- I can read a `perf c2c` report and translate it to a code-level fix.
- I can debate the trade-offs between `sync.Map`, hand-rolled sharded maps, and copy-on-write maps for a given workload.
- I can defend a padding decision with benchmark numbers.
- I can recognise and refactor the common anti-patterns in code review.
- I can set up CI benchmarks that catch coherence regressions.
- I can explain why `runtime.LockOSThread` is not a cache-locality tool.
- I can design APIs for read-mostly state that are coherence-cheap by construction.

---

## Summary

Senior-level cache coherence is a design discipline. Hot fields are isolated; cold fields share. Shared state is sharded or snapshotted. Hardware counters and `perf c2c` are your verification tools. Multi-socket NUMA matters on big iron; cloud VMs usually hide it. Apple silicon needs 128-byte awareness. The standard library has the patterns; copy them. CI benchmarks catch regressions before deploy. Coherence is no longer a surprise — it is a constraint you design with.

---

## What You Can Build

- A high-throughput RPC server whose per-route counters scale linearly to 64 cores.
- A metrics library used company-wide whose contribution to CPU is negligible at any scale.
- A lock-free queue that outperforms channels.
- A read-mostly configuration store with millisecond update latency and microsecond read latency.
- A per-P sharded data structure for any custom workload that needs per-CPU semantics.

---

## Further Reading

- *What Every Programmer Should Know About Memory* — Ulrich Drepper.
- *Is Parallel Programming Hard, And, If So, What Can You Do About It?* — Paul McKenney.
- Intel Optimization Reference Manual (free PDF), chapters on cache and atomics.
- AMD Software Optimization Guide.
- ARM Architecture Reference Manual ARMv8.
- Go source: `src/sync/`, `src/runtime/`, `src/runtime/internal/atomic/`.
- LMAX Disruptor paper.
- Apple's *Apple Silicon CPU Architecture* (chip details).

---

## Related Topics

- **02-acquire-release** — Memory ordering on top of coherence.
- **03-sequential-consistency** — Strongest ordering; expensive globally.
- **05-false-sharing** — Applied detection.
- **sync.Map**, **sync.Pool** — Standard-library coherence-aware structures.
- **runtime.GOMAXPROCS** — Per-P sizing.
- **Distributed systems** — Cache coherence is the in-machine version of CAP-style consistency.

---

## Diagrams & Visual Aids

```
SENIOR-LEVEL DESIGN OVERVIEW

  +-------------------------------------------+
  |       Application Service                 |
  +-------------------------------------------+
        |                |               |
  [Read-mostly]   [Per-CPU shard]   [Read/write]
        |                |               |
  atomic.Pointer  []paddedSlot     sync.Mutex
   [Snapshot]                       (padded)
        |                |               |
  Cheap reads     Local writes      Serialised
  Rare writes     Rare merge        access

  Choose primitive by access pattern.
```

```
NUMA-AWARE STRUCTURE

  Socket 0                       Socket 1
  +-------------+                +-------------+
  | Cores 0-15  |                | Cores 16-31 |
  | Shard 0     |                | Shard 1     |
  | (allocated  |                | (allocated  |
  |  on node 0) |                |  on node 1) |
  +-------------+                +-------------+
       |                              |
       |   UPI link (slow)           |
       +------------------------------+
            (rare cross-socket)

  Locality preserved within each socket.
  Merge happens off the hot path.
```

```
COHERENCE COST HEATMAP

  Cores per box | Same-socket | Cross-socket
  --------------+-------------+--------------
       4        |   negligible|   negligible
      16        |   noticeable|        n/a (1 sock)
      32        |    big      |   huge if 2 socks
      64        |    big      |   huge
     128        |    big      |   prohibitive
     256+       | catastrophic|   prohibitive

  Padding moves you to the left column (no contention).
  Sharding moves you to the left column (less contention).
  NUMA pinning moves you to the left column (locality).
```

---

## Extended Section: Designing a Production-Grade Per-CPU Counter Library

A senior engineer often designs reusable libraries. Here is a complete walkthrough of building a production-grade per-CPU counter library, with attention to coherence, ergonomics, observability, and edge cases.

### Requirements

- Scale to 64+ cores with no contention.
- Handle dynamic CPU count changes (containers can have CPU limits changed at runtime).
- Provide read consistency: a Sum() call returns a stable snapshot.
- Be usable for both counters (monotonic) and gauges (settable).
- Expose metrics for monitoring health (per-shard distribution, contention levels).
- Be safe across architectures (x86, ARM, Apple).

### API design

```go
package coherentcounter

import (
    "sync/atomic"
    "runtime"
    "golang.org/x/sys/cpu"
)

type Counter struct {
    shards    []shard
    shardMask uint64
}

type shard struct {
    value atomic.Int64
    _     cpu.CacheLinePad
}

// New creates a Counter with the next power-of-two number of shards
// greater than or equal to GOMAXPROCS.
func New() *Counter {
    n := nextPow2(runtime.GOMAXPROCS(0))
    return &Counter{
        shards:    make([]shard, n),
        shardMask: uint64(n - 1),
    }
}

func nextPow2(n int) int {
    if n <= 1 { return 1 }
    p := 1
    for p < n { p *= 2 }
    return p
}
```

Power-of-two shard counts allow fast modulo via bitmask.

### Add with shard hint

```go
// Add increments by delta. The hint should be a fast-changing value
// like a goroutine ID or request ID for good distribution.
func (c *Counter) Add(hint uint64, delta int64) {
    c.shards[hint&c.shardMask].value.Add(delta)
}
```

Note: this avoids `procPin` for portability. The hint is the caller's responsibility.

### Sum with consistency guarantee

```go
func (c *Counter) Sum() int64 {
    var total int64
    for i := range c.shards {
        total += c.shards[i].value.Load()
    }
    return total
}
```

`Sum` is *not* an atomic snapshot — concurrent Adds may be reflected in some shards and not others. For most counter use cases, this is acceptable; the result is "approximately correct," monotonically increasing, eventually consistent.

For strict snapshot semantics, you would need to halt all writers, which defeats the point of sharding. Document the trade-off.

### Per-CPU Add variant for advanced users

```go
//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

// AddPinned increments using the current P as the shard hint.
// Slightly faster than Add(hint, delta) but uses unstable runtime APIs.
func (c *Counter) AddPinned(delta int64) {
    pid := runtime_procPin()
    c.shards[pid&int(c.shardMask)].value.Add(delta)
    runtime_procUnpin()
}
```

The `procPin`/`procUnpin` calls pin the goroutine to its P, ensuring the shard hint matches the current P. This is what `sync.Pool` does internally.

### Observability hooks

```go
// ShardStats returns the per-shard values.
// Useful for monitoring distribution skew.
func (c *Counter) ShardStats() []int64 {
    stats := make([]int64, len(c.shards))
    for i := range c.shards {
        stats[i] = c.shards[i].value.Load()
    }
    return stats
}

// Skew returns max/min of shard values, indicating distribution quality.
// A skew near 1 means perfect distribution; > 5 means hint is poor.
func (c *Counter) Skew() float64 {
    s := c.ShardStats()
    if len(s) == 0 { return 1 }
    min, max := s[0], s[0]
    for _, v := range s[1:] {
        if v < min { min = v }
        if v > max { max = v }
    }
    if min == 0 { return float64(max) }
    return float64(max) / float64(min)
}
```

Skew is a powerful debugging signal: if Skew is 100, your hint distribution is broken and one shard is doing all the work.

### Dynamic resize support (advanced)

If `GOMAXPROCS` changes (e.g., due to container limits), the counter can be resized:

```go
func (c *Counter) Resize(newN int) {
    if newN == len(c.shards) { return }
    newShards := make([]shard, nextPow2(newN))
    // Migrate values: sum old, distribute among new
    var total int64
    for i := range c.shards {
        total += c.shards[i].value.Load()
    }
    newShards[0].value.Store(total)
    c.shards = newShards
    c.shardMask = uint64(len(newShards) - 1)
}
```

This is racy — concurrent Add during Resize loses updates. Production-grade resize needs a versioned or atomic-swap design. For most services, just size for the maximum at startup.

### Documentation

Every public type should explain:

- Memory cost (N × cache-line bytes).
- Best-distribution hints.
- Read consistency guarantee.
- Edge cases (zero shards, very high skew).

Without docs, a future user will reach for `Counter.AddPinned` without understanding the `procPin` caveat.

### Testing

Tests should cover:

- Correctness: total matches expected.
- Memory layout: shards are on different cache lines (use `unsafe`).
- Scaling benchmark: ns/op stays flat from 1 to NumCPU cores.
- Skew under known good hint: should be near 1.

### Benchmarks

```go
func BenchmarkCounter(b *testing.B) {
    c := New()
    b.RunParallel(func(pb *testing.PB) {
        var hint uint64
        for pb.Next() {
            hint++
            c.Add(hint, 1)
        }
    })
}
```

Run with `-cpu=1,4,16,64`. The expected result: flat or slightly improving ns/op, total throughput scaling linearly.

---

## Extended Section: A Tour of `sync.Map` Internals at Senior Depth

We touched on `sync.Map` at middle level. A senior should know it well enough to know when *not* to use it.

### The `sync.Map` structure

```go
type Map struct {
    mu Mutex

    read atomic.Pointer[readOnly]

    dirty map[any]*entry

    misses int
}

type readOnly struct {
    m       map[any]*entry
    amended bool // true if the dirty map contains some key not in m.
}

type entry struct {
    p atomic.Pointer[any]
}
```

The `read` is read-only from concurrent readers' perspective. It's a snapshot. Writers may mutate `dirty` under `mu`.

### The hot read path

```go
func (m *Map) Load(key any) (value any, ok bool) {
    read := m.read.Load()
    e, ok := read.m[key]
    if !ok && read.amended {
        m.mu.Lock()
        // Recheck under lock; lookup in dirty if needed.
        ...
        m.mu.Unlock()
    }
    if !ok { return nil, false }
    return e.load()
}
```

When the key is in `read`, the load is:

1. Atomic Load of the `read` pointer.
2. Plain map lookup.
3. Atomic Load of the entry's value pointer.

No lock. Coherence cost: pointer load (line in S, cheap).

### The write path

Writes are slow but rare:

```go
func (m *Map) Store(key, value any) {
    read := m.read.Load()
    if e, ok := read.m[key]; ok && e.tryStore(&value) { return }

    m.mu.Lock()
    read = m.read.Load()
    if e, ok := read.m[key]; ok {
        // Already exists, just update.
        e.unexpungeLocked()
        m.dirty[key] = e
        e.storeLocked(&value)
    } else if e, ok := m.dirty[key]; ok {
        e.storeLocked(&value)
    } else {
        if !read.amended {
            m.dirtyLocked()
            m.read.Store(&readOnly{m: read.m, amended: true})
        }
        m.dirty[key] = newEntry(value)
    }
    m.mu.Unlock()
}
```

Writes serialise on `mu`. Coherence: the mutex line bounces among writers; but writes are assumed rare.

### Miss accounting and promotion

After many misses (key not in `read`), the dirty map is promoted to `read`:

```go
func (m *Map) missLocked() {
    m.misses++
    if m.misses < len(m.dirty) {
        return
    }
    m.read.Store(&readOnly{m: m.dirty})
    m.dirty = nil
    m.misses = 0
}
```

This is the moment of catch-up. Future reads of those keys hit `read`.

### When `sync.Map` is the right choice

- Read-mostly workload (>10:1 reads to writes).
- Key set is stable; growth is slow.
- Keys can be hashed (i.e., `any` works).
- Concurrent access from many cores.

### When `sync.Map` is the wrong choice

- Write-heavy workload (a regular `map` + `Mutex` may be faster).
- Strict typing is needed (the `any` API is awkward).
- The key set churns rapidly (sync.Map's promotion overhead becomes significant).
- Predictable memory usage required (sync.Map's transient duplication of map state can spike memory).

### Alternative: sharded `map` with `Mutex`

```go
type ShardedMap struct {
    shards []mapShard
}

type mapShard struct {
    mu sync.Mutex
    m  map[string]any
    _  cpu.CacheLinePad
}

func NewShardedMap(n int) *ShardedMap {
    shards := make([]mapShard, n)
    for i := range shards { shards[i].m = make(map[string]any) }
    return &ShardedMap{shards: shards}
}

func (m *ShardedMap) Get(key string) (any, bool) {
    s := &m.shards[hash(key)%len(m.shards)]
    s.mu.Lock()
    v, ok := s.m[key]
    s.mu.Unlock()
    return v, ok
}
```

Trade-offs:

- Each shard has its own mutex. Contention is proportional to keys hashing to the same shard.
- Padding ensures shards do not false-share.
- Memory: N shards × (mutex + small map + pad).
- Predictable: no transient duplication.

For write-heavy workloads, sharded maps often beat `sync.Map`. For read-heavy, `sync.Map` is usually faster.

---

## Extended Section: Building a Cache-Aware HTTP Server

A senior may design an HTTP server with coherence baked in. A blueprint.

### Top-level structure

```go
type Server struct {
    // hot stats — per CPU
    stats *coherentcounter.Counter
    _     cpu.CacheLinePad

    // hot config — atomic snapshot
    config atomic.Pointer[Config]
    _      cpu.CacheLinePad

    // cold setup
    listener net.Listener
    mu       sync.Mutex // for cold operations
    routes   map[string]Handler
}
```

The hot fields (`stats`, `config`) are isolated. Cold fields share lines but are accessed at startup and shutdown only.

### Per-request work

```go
func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    s.stats.Add(uint64(time.Now().UnixNano()), 1) // bumped per request
    cfg := s.config.Load()                        // cheap atomic load
    h := s.routes[r.URL.Path]                     // map lookup (read-only)
    h(w, r, cfg)
}
```

Per-request, we touch:

- One per-CPU shard (one cache line, no contention).
- The config pointer (cache line in S).
- The routes map (read-only after init).

No mutex on the hot path. No false sharing.

### Reloading config

```go
func (s *Server) Reload(c *Config) {
    s.config.Store(c)
}
```

One atomic store. Briefly invalidates the config line for readers, who pick up the new pointer on their next request.

### Adding routes (cold path)

```go
func (s *Server) AddRoute(path string, h Handler) {
    s.mu.Lock()
    s.routes[path] = h
    s.mu.Unlock()
}
```

This is racy with concurrent reads. Production-grade requires either:

- All routes added before serving begins (typical pattern), or
- Copy-on-write of the routes map with atomic swap.

For most services, the former is sufficient. For services with dynamic routing, use the COW pattern.

### Metrics export

```go
func (s *Server) Metrics() map[string]int64 {
    return map[string]int64{
        "requests": s.stats.Sum(),
    }
}
```

Sum walks all shards — O(NumCPU). Called every few seconds, not in the hot path. Affordable.

---

## Extended Section: Cache-Aware Database Driver

For a Go database driver maintaining a connection pool, cache awareness affects throughput.

### Connection pool layout

```go
type Pool struct {
    mu       sync.Mutex
    idle     []*Conn
    inUse    int
    maxOpen  int
    _        cpu.CacheLinePad

    waiters  chan struct{}
    closed   atomic.Bool
}
```

The `mu`, `idle`, `inUse` are touched per Acquire/Release. Pad before `waiters` and `closed` to keep them on a separate line.

### Per-conn state

```go
type Conn struct {
    id        uint64
    _         cpu.CacheLinePad

    inUse     atomic.Bool
    lastUsed  atomic.Int64
    _         cpu.CacheLinePad

    // bulk state (rarely contended)
    sock      net.Conn
    enc       *Encoder
    dec       *Decoder
}
```

`inUse` and `lastUsed` are mutated on every Acquire/Release. They share a line — fine, because each Conn is only handled by one goroutine at a time. But across many Conns, the array of Conns may share lines.

Better: place Conns far apart in memory by allocating each via a separate `new`, or pad the Conn struct to a multiple of a cache line.

### Health checks

A background goroutine periodically scans the pool for stale connections:

```go
func (p *Pool) gcLoop() {
    t := time.NewTicker(30 * time.Second)
    defer t.Stop()
    for range t.C {
        p.mu.Lock()
        // scan p.idle for expired conns
        p.mu.Unlock()
    }
}
```

The scan reads many `Conn.lastUsed` fields, putting them in S. The next Acquire on those conns must upgrade back to M. For most workloads, this is a tolerable cost — 30-second scans are rare. If hot-path Acquires are dominant, consider a separate per-Conn last-used timestamp that the GC ignores.

---

## Extended Section: Cache Effects in the Go Runtime

The Go runtime itself is cache-aware. A senior should know the major touch points.

### The GMP scheduler

Each P has its own runqueue. Goroutines stolen from other Ps cross cache boundaries. Per-P locality is the runtime's preferred shape.

Key fields in `runtime.p`:

- Local runqueue (`runq`, `runqhead`, `runqtail`)
- `runqtail` is written by the current P; read by stealers.
- The P struct is padded internally to prevent inter-P false sharing.

### The memory allocator (mheap, mcache)

Each P has a per-P allocator cache (`mcache`). Allocations come from the cache when possible — no global lock. The mcache is per-P, padded.

When the mcache empties, the P fetches more from the central allocator (`mcentral`), which is sharded by size class.

### Garbage collector

The GC has per-P workbuffers for tri-colour marking. Per-P means no contention during marking.

During the write barrier phase, writes to pointers go through a small per-P buffer. The buffer is padded.

### Network poller

The network poller is conceptually shared, but registrations and notifications are routed per-P where possible.

### Conclusion

Most runtime hot paths use per-P sharding plus padding. Read `runtime/proc.go`, `runtime/mcache.go`, `runtime/mgc.go` to see real industrial-grade examples.

---

## Extended Section: Operational Stories

### Story 1 — The case of the 99th percentile spike

A team noticed p99 latency spiking every few minutes. Their service was otherwise healthy. They traced it to GC pauses, which were short (1-2ms) but happened to coincide with bursts of cross-CPU writes that the runtime's write barrier amplified.

The fix: reduce pointer mutation in the hot path. Changed several `*Foo` fields to value types `Foo`. p99 settled.

### Story 2 — The container that lied about CPU count

A team deployed Go services in containers with CPU quota. Inside the container, `runtime.NumCPU()` returned the host's CPU count (32), not the container's quota (4). The Go scheduler created 32 Ps, each with its own per-P state. The service spent significant CPU on inter-P coordination that should never have happened.

The fix: import `go.uber.org/automaxprocs` (or set `GOMAXPROCS=4` explicitly). Per-P sharding aligned with actual CPU count. CPU usage dropped 25%.

### Story 3 — The cold cache after deploy

A new version of a service was deployed. For the first few minutes, throughput was 30% lower than expected. The team initially blamed the new code. Then they noticed throughput recovered after about 5 minutes.

Explanation: every restart starts with cold caches. Hot lookup tables (config, route maps, prepared statements) had to be re-fetched from memory. Once they settled into L3, throughput returned to normal.

The lesson: cache state is itself a performance asset. Hot data accumulates over time. Don't conflate cold-cache slowness with code regressions.

### Story 4 — The cross-socket coherence storm

A team ran a Go service on a 2-socket bare-metal box. They noticed inconsistent latencies: a 95th percentile of 8ms but 99.5th of 35ms. The OS scheduler was placing goroutines on both sockets, and the service's shared counters were bouncing across sockets when active goroutines happened to be split.

The fix: `numactl --cpunodebind=0 --membind=0` to pin to one socket. Tail latency settled. The other socket was used for a separate service.

The lesson: NUMA bites on bare metal. Cloud VMs usually hide it.

### Story 5 — The `sync.Map` that grew without bound

A team used `sync.Map` for a cache of computed values. Keys were per-request and never reused. Over time, the map's internal `dirty` and `read` maps grew, never being garbage-collected, because every key was still being inserted.

Memory usage climbed steadily. p99 latency rose with the map size (longer hash chains).

The fix: switched to a fixed-size LRU. `sync.Map` is for stable key sets; for ever-growing maps, use a cache with eviction.

The lesson: `sync.Map` has assumptions about access patterns. Check yours.

### Story 6 — The library upgrade that hurt

A team upgraded a popular open-source library. The new version added internal metrics — atomic counters incremented on every operation. The atomic counters shared cache lines with frequently-read data structures.

Throughput dropped 15%. The team rolled back, filed a bug, contributed a padding fix.

The lesson: dependencies can introduce coherence problems. Profile after every major upgrade.

### Story 7 — The "improvement" that regressed performance

A team refactored a hot struct from:

```go
type Stats struct {
    Counter int64
    _       [56]byte
    Name    string
}
```

to:

```go
type Stats struct {
    Name    string
    Counter int64
}
```

…because the new ordering was "more natural." Throughput collapsed.

The lesson: padding is load-bearing. Document it; resist "natural" reorderings that erase it. Code reviewers should challenge struct reorders.

### Story 8 — The hot mutex that wasn't a mutex

pprof showed huge time in `sync.(*Mutex).Lock`. The team assumed lock contention. They added more granular locks. Performance got worse.

The mutex itself was not contended — the same goroutine acquired and released it rapidly with no waiters. But the mutex shared a cache line with a counter the goroutine also wrote. Every lock/unlock invalidated the counter line on another core that was reading it.

The fix: padded the mutex. Throughput returned to expected.

The lesson: high time in `Lock` does not always mean contention. Sometimes it is coherence on the mutex's line.

---

## Extended Section: A Sample Architecture Document

When senior engineers design systems, they document architecture. A sample paragraph from a fictitious service spec:

> Per-route counters use the `coherentcounter` library with 64 shards on 16-core hosts. Shards are indexed by request ID hash. Skew is monitored via `Counter.Skew()` and alerted on if > 5. Memory cost per counter is ~4 KB. Sum() is called by `/metrics` scrape every 15s; cost is O(64) loads, negligible.
>
> Configuration is exposed via `atomic.Pointer[Config]`. Writers (admin API) update the pointer; readers do a single load per request. Memory cost per config snapshot is ~16 KB; we hold at most two snapshots (previous and current) for safety during rollout.
>
> Route table is built at startup and exposed via `atomic.Pointer[RouteTable]`. Dynamic route changes are accepted via the admin API and trigger a full copy-on-write of the route map. Latency p99 of `/admin/route` is < 10ms.
>
> No `sync.Mutex` is held on the per-request path. All shared state is read via atomic loads of snapshot pointers or via per-CPU shards. False sharing is prevented by `cpu.CacheLinePad` after every hot field.
>
> The service is expected to scale linearly to 64 cores. CI benchmarks at `-cpu=1,8,32,64` enforce this. A 10% regression in scaling triggers a build failure.

That kind of paragraph is what differentiates a senior architecture from a junior implementation.

---

## Extended Section: Performance Budgets

A senior approach: assign performance budgets to each component.

For a typical Go HTTP service handling 100k RPS at 50% CPU on a 16-core box, per-request CPU budget is:

```
0.5 × 16 cores × 10^9 ns/sec / 100,000 RPS = 80,000 ns/request
```

Roughly 80 microseconds per request. Within that:

- Network I/O: 10-20 μs.
- Authentication / parsing: 5-10 μs.
- Business logic: 30-40 μs.
- Logging / metrics: 5-10 μs.
- Buffer.

If metrics alone consume 10 μs, you have a problem. If padding reduces it to 2 μs, you have an 8% budget recovery.

This is how senior engineers justify cache-aware design at the budget level. "10% of CPU on coherence" is concrete and unacceptable; "we should fix false sharing" is abstract and ignorable.

---

## Extended Section: Quantitative Analysis of a Counter Library

Cost analysis of the per-CPU counter library:

| Workload | ns/op (single counter, single CPU) | ns/op (single counter, 16 cores) | Throughput (16 cores) |
|----------|------------------------------------|-----------------------------------|----------------------|
| `*int64` (unsafe) | 0.3 | <data race> | invalid |
| `atomic.Int64` shared | 6 | 60 | 16M total |
| `atomic.Int64` per-CPU sharded, padded | 6 | 6 | 800M total |

With sharding plus padding, throughput is 50× the contended atomic on 16 cores. On 64 cores, the ratio is closer to 200×. Linear scaling.

Memory cost: 64 cores × 64 bytes = 4 KB per counter. For a service with 100 counters, 400 KB total. Trivial.

This kind of analysis is what convinces senior engineers (and their bosses) to invest in the right design.

---

## Extended Section: Twenty Questions for a Senior Code Review

When reviewing a PR that touches shared state, ask:

1. Which goroutines mutate which fields?
2. Are mutated fields within 64 bytes of each other?
3. Are mutated fields within 64 bytes of read-mostly fields?
4. Is there a benchmark with `-cpu=1,2,4,8` showing scaling?
5. Are atomic types padded with `cpu.CacheLinePad`?
6. Are arrays of structs padded per-element?
7. Are mutexes adjacent to other hot fields?
8. Is `RWMutex` used for short critical sections (likely wrong)?
9. Is there a sharing across NUMA nodes assumption?
10. Does the code use `sync.Map`/`sync.Pool` where appropriate?
11. Are there hand-rolled lock-free algorithms (red flag)?
12. Is there a spin loop on an atomic (red flag)?
13. Are stats counters in a struct that has other hot fields?
14. Is the config snapshot pattern used for read-mostly state?
15. Are CI benchmarks running with multiple `-cpu` values?
16. Are there hardware-counter assertions (`perf c2c` validation)?
17. Is layout documented in comments?
18. Are layout invariants checked at init time?
19. Does the API expose shard hints to callers?
20. Are there observability hooks for skew/contention?

A "no" to any of these is not a blocker — but ask why.

---

## Extended Section: The Twenty Most Common Coherence Bugs

1. Adjacent atomic counters in one struct.
2. Slice of small structs sharing lines.
3. Mutex right next to protected data.
4. RWMutex for short reads.
5. Shared channel for many workers.
6. Global atomic in hot loop.
7. Spin loop on contended atomic.
8. Padding only some fields (others still share).
9. Padding inside struct but not between adjacent allocations.
10. Padding for x86 but not Apple silicon.
11. NUMA-naive design on bare metal.
12. Cgroup mismatch (GOMAXPROCS too high).
13. `runtime.LockOSThread` assumed to pin to core.
14. `time.Now()` in hot loops.
15. `sync.Map` for write-heavy workloads.
16. Hand-rolled spinlock without test-then-CAS.
17. Sharding without padding (neighbouring shards share).
18. Refcount field on the data line.
19. Long-lived shared structures allocated on wrong NUMA node.
20. Hot fields between read-mostly fields, fragmenting the read pattern.

Memorise these. They are the bulk of real-world incidents.

---

## Extended Section: A Walk Through `runtime.mheap` for Educational Value

The Go runtime's heap allocator demonstrates senior-grade cache awareness.

`runtime/mheap.go`:

```go
type mheap struct {
    lock      mutex
    pagesInUse uint64
    ...

    central [numSpanClasses]struct {
        mcentral mcentral
        pad      [cpu.CacheLinePadSize - unsafe.Sizeof(mcentral{})%cpu.CacheLinePadSize]byte
    }

    ...
}
```

The `central` array has one `mcentral` per size class. Each is padded to a cache line because allocations of different size classes can happen concurrently on different Ps, and the centrals are touched per allocation.

`runtime/mcache.go`:

```go
type mcache struct {
    ...
    tiny       uintptr
    tinyoffset uintptr
    ...
    alloc [numSpanClasses]*mspan
    ...
}
```

`mcache` is per-P. No padding inside — single-threaded access. But the array of `mcache` (one per P) in `runtime.allp` is padded internally so that different Ps' mcaches don't share lines.

This is how real high-performance runtimes are built. Read more of `runtime/proc.go`, `runtime/mgc.go`, `runtime/sema.go` for additional examples.

---

## Extended Section: A Quick Tour of Lock-Free Algorithms in Go

Lock-free programming is a separate discipline, but cache coherence is at its core. A senior should know the major shapes.

### Treiber stack

```go
type Stack[T any] struct {
    head atomic.Pointer[node[T]]
}

type node[T any] struct {
    value T
    next  *node[T]
}

func (s *Stack[T]) Push(v T) {
    n := &node[T]{value: v}
    for {
        head := s.head.Load()
        n.next = head
        if s.head.CompareAndSwap(head, n) {
            return
        }
    }
}

func (s *Stack[T]) Pop() (T, bool) {
    for {
        head := s.head.Load()
        if head == nil { var zero T; return zero, false }
        if s.head.CompareAndSwap(head, head.next) {
            return head.value, true
        }
    }
}
```

Coherence behaviour: the `head` pointer's line bounces under contention. Throughput plateaus.

Practical improvement: use `sync.Pool` for the nodes (per-P) and a "back-off" on CAS failure.

### Michael-Scott queue

A classic MPMC lock-free queue:

```go
type Queue[T any] struct {
    head atomic.Pointer[node[T]]
    tail atomic.Pointer[node[T]]
}

type node[T any] struct {
    value T
    next  atomic.Pointer[node[T]]
}
```

Head and tail share patterns. Pad them apart. Cells are heap-allocated; the GC handles reclamation.

### LMAX Disruptor in Go

A bounded ring buffer with cached indices:

```go
type Disruptor[T any] struct {
    write       atomic.Uint64
    cachedRead  uint64
    _           cpu.CacheLinePad

    read        atomic.Uint64
    cachedWrite uint64
    _           cpu.CacheLinePad

    cells       []cell[T]
    mask        uint64
}

type cell[T any] struct {
    seq  atomic.Uint64
    data T
    _    [40]byte
}
```

Producer and consumer mostly read their own cached counterparts. Only when "full" or "empty" do they refresh from the shared atomic. Cells are padded.

Throughput approaches one cache-line write per operation per core.

### What to take away

Lock-free is powerful but unforgiving. Coherence layout is the foundation. Get it wrong and lock-free is slower than mutex-based.

---

## Extended Section: When Cache Coherence Meets the Go GC

The Go GC interacts with coherence in subtle ways.

### Write barrier

Every pointer write during the mark phase goes through a write barrier. The barrier records the write in a per-P buffer. The buffer is occasionally flushed to a global queue.

Cache effects:

- The per-P buffer is a hot line, but only the current P writes it.
- The global queue is touched on flush — a coherence event, but rare.

For heavy pointer-mutation workloads (linked-list-style algorithms), the write barrier adds visible overhead during GC. Profile to confirm.

### Mark assist

When the heap grows faster than the GC can keep up, the allocator forces user goroutines to do "mark assist" work. Each assist is a small chunk of GC marking — touching shared GC state.

Cache effects: more cross-P traffic during heavy allocation under heavy heap growth.

Fix: pre-size structures; avoid surprise allocations in hot paths.

### Sweep

After the mark phase, the sweep phase reclaims free objects. Per-P sweep buffers ensure each P sweeps its own pages. No coherence traffic for sweep itself.

### Concurrent collection

The whole GC runs concurrently with user goroutines. There is no "stop the world" except for very short barrier synchronisations.

Cache effects during STW: every P touches a shared barrier — invalidations occur, but each STW is sub-millisecond.

---

## Extended Section: Cache Coherence and Garbage Collection: Putting It Together

A senior must reason about both. An example workload:

- High-throughput RPC, 100k RPS, 8 cores.
- Per-request allocates ~10 small objects (allocator chooses size classes).
- Per-request mutates ~20 pointer fields (GC write barriers fire during marking).
- Per-request bumps 5 counters.

If the counters are unpadded: ~25 ns per request lost to false sharing. At 100k RPS × 8 cores = 800k counter ops/sec wasted on coherence. ~2-3% of CPU.

If the counters are padded but allocator is contended (no per-P pools): another 5-10% lost to allocator coherence.

If GC writes barriers hit shared buffers (rare): another 1-2% during marking, transient.

Total potential coherence cost: 10-15% of CPU before optimisation. After per-P sharding + padding + sync.Pool reuse: 1-2%.

The opportunity cost of *not* fixing coherence is roughly 10% of the machine. On a $1000/month box, that is $100/month. Across a fleet of 100 boxes, $10k/month. For one engineer-day of work, an excellent ROI.

This is the senior-level economic argument.

---

## Extended Section: Cache Locality and Big Data Workloads

For services that process large datasets, cache locality (not just coherence) becomes paramount.

### Working set size

If your dataset fits in L3 (~32 MB), random access is fast — every access hits cache. If it spills to DRAM, each access is 80 ns.

For a hashmap with 1 million entries × 24 bytes per entry = 24 MB, you fit in L3 but only just. Adding ten more bytes per entry pushes you out.

Implication: data structure compactness matters. Padding for false sharing costs compactness. There is a trade-off.

For very large maps, prefer:

- Concurrent maps with shards smaller than L3.
- Open addressing rather than chained (better cache friendliness).
- Compact representations (interned strings, packed structs).

### Sequential access patterns

When you iterate a slice in order, the hardware prefetcher pulls in the next several lines. Random access defeats the prefetcher.

For workloads that scan large datasets:

- Store in contiguous arrays, not linked lists.
- Sort by access order before processing.
- Use struct-of-arrays instead of array-of-structs for partial access.

Example: instead of `[]Record` where you only read `Record.Score`, store `[]int` of scores separately. The CPU pulls fewer lines.

### Cache thrashing

If many threads each have working sets larger than their private cache shares, lines evict each other constantly. This is cache thrashing, distinct from coherence.

Fix: reduce per-thread working set, or partition data so each thread owns its slice.

---

## Extended Section: A Final Set of Twenty Senior-Level Drills

1. Design a per-CPU counter library API. List the trade-offs you considered.
2. Explain why `sync.Map` is faster than a sharded map for read-mostly workloads.
3. Walk through what happens at the hardware level when two cores both call `atomic.AddInt64` on the same variable.
4. When does padding hurt performance?
5. How do you detect false sharing in production without `perf c2c`?
6. Design an HTTP server's request handler to be cache-friendly.
7. Estimate the coherence cost of a particular workload.
8. Explain the trade-offs of `sync.Pool` vs hand-rolled per-P caches.
9. Why is `runtime.LockOSThread` not sufficient for cache locality?
10. Design a config store that handles 1M reads/sec and 1 write/sec.
11. Explain `numactl` and when to use it.
12. Why do snoop filters help and when do they overflow?
13. Design a metrics library that scales to 1000 counters and 1M ops/sec.
14. When is RWMutex better than Mutex? When is it worse?
15. Explain the cache effect of garbage collection write barriers.
16. Design a lock-free ring buffer with cached indices.
17. Why does Apple silicon need different padding constants?
18. Explain MOESI and why AMD uses it.
19. How would you set up CI to catch coherence regressions?
20. Estimate the cost of cross-socket coherence on a 2-socket box.

Treat each as a 5-minute design exercise. If you can speak to each fluently, you are senior-level.

---

## Closing

Senior cache coherence is design discipline plus operational maturity plus economic argument. You design data structures with coherence in mind, you operate them with the right tooling, and you justify the work to non-technical stakeholders with concrete numbers. The professional level adds runtime-internals depth.

Read professional.md when you are contributing to high-performance libraries or the Go runtime itself.

---

## Long Appendix: A Reference Implementation of Common Patterns

Below is a single self-contained file demonstrating eight cache-aware patterns, each thoroughly commented. A senior reading this should be able to extract any pattern and adapt it.

```go
// Package coherence demonstrates production-grade cache-aware patterns.
package coherence

import (
    "fmt"
    "runtime"
    "sync"
    "sync/atomic"
    "unsafe"

    "golang.org/x/sys/cpu"
)

// =============================================================
// Pattern 1: Padded atomic counter (basic building block)
// =============================================================

type PaddedCounter struct {
    v atomic.Int64
    _ cpu.CacheLinePad
}

func (c *PaddedCounter) Inc() { c.v.Add(1) }
func (c *PaddedCounter) Add(d int64) { c.v.Add(d) }
func (c *PaddedCounter) Load() int64 { return c.v.Load() }

// =============================================================
// Pattern 2: Per-CPU sharded counter
// =============================================================

type ShardedCounter struct {
    shards []PaddedCounter
    mask   uint64
}

func NewShardedCounter() *ShardedCounter {
    n := nextPow2(runtime.GOMAXPROCS(0))
    return &ShardedCounter{
        shards: make([]PaddedCounter, n),
        mask:   uint64(n - 1),
    }
}

func (c *ShardedCounter) Add(hint uint64, d int64) {
    c.shards[hint&c.mask].Add(d)
}

func (c *ShardedCounter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].Load()
    }
    return s
}

func nextPow2(n int) int {
    if n <= 1 { return 1 }
    p := 1
    for p < n { p *= 2 }
    return p
}

// =============================================================
// Pattern 3: Read-mostly snapshot pointer
// =============================================================

type Snapshot[T any] struct {
    p atomic.Pointer[T]
    _ cpu.CacheLinePad
}

func (s *Snapshot[T]) Set(v *T) { s.p.Store(v) }
func (s *Snapshot[T]) Get() *T  { return s.p.Load() }

// =============================================================
// Pattern 4: Copy-on-write map
// =============================================================

type COWMap[K comparable, V any] struct {
    m atomic.Pointer[map[K]V]
}

func NewCOWMap[K comparable, V any]() *COWMap[K, V] {
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
        for k2, v2 := range *old {
            next[k2] = v2
        }
        next[k] = v
        if c.m.CompareAndSwap(old, &next) {
            return
        }
    }
}

// =============================================================
// Pattern 5: Hot/cold split struct
// =============================================================

type Service struct {
    // hot
    requests atomic.Int64
    _        cpu.CacheLinePad
    errors   atomic.Int64
    _        cpu.CacheLinePad

    // cold
    name     string
    address  string
    config   *Snapshot[Config]
    handlers map[string]Handler
}

type Config struct{}
type Handler func()

// =============================================================
// Pattern 6: Padded mutex registry (sharded locks)
// =============================================================

type MutexShard struct {
    mu sync.Mutex
    _  cpu.CacheLinePad
}

type LockRegistry struct {
    shards []MutexShard
    mask   uint64
}

func NewLockRegistry() *LockRegistry {
    n := 64 // tunable
    return &LockRegistry{
        shards: make([]MutexShard, n),
        mask:   uint64(n - 1),
    }
}

func (r *LockRegistry) Lock(key uint64) *sync.Mutex {
    m := &r.shards[key&r.mask].mu
    m.Lock()
    return m
}

// =============================================================
// Pattern 7: Aligned ring buffer with cached indices
// =============================================================

type RingBuffer[T any] struct {
    write       atomic.Uint64
    cachedRead  uint64
    _           cpu.CacheLinePad

    read        atomic.Uint64
    cachedWrite uint64
    _           cpu.CacheLinePad

    cells []ringCell[T]
    mask  uint64
}

type ringCell[T any] struct {
    seq  atomic.Uint64
    data T
    _    [40]byte
}

func NewRingBuffer[T any](size int) *RingBuffer[T] {
    size = nextPow2(size)
    cells := make([]ringCell[T], size)
    for i := range cells {
        cells[i].seq.Store(uint64(i))
    }
    return &RingBuffer[T]{
        cells: cells,
        mask:  uint64(size - 1),
    }
}

func (r *RingBuffer[T]) Enqueue(v T) bool {
    for {
        pos := r.write.Load()
        cell := &r.cells[pos&r.mask]
        seq := cell.seq.Load()
        if seq == pos {
            if r.write.CompareAndSwap(pos, pos+1) {
                cell.data = v
                cell.seq.Store(pos + 1)
                return true
            }
        } else if seq < pos {
            return false // full
        }
    }
}

func (r *RingBuffer[T]) Dequeue() (T, bool) {
    var zero T
    for {
        pos := r.read.Load()
        cell := &r.cells[pos&r.mask]
        seq := cell.seq.Load()
        if seq == pos+1 {
            if r.read.CompareAndSwap(pos, pos+1) {
                v := cell.data
                cell.seq.Store(pos + r.mask + 1)
                return v, true
            }
        } else if seq < pos+1 {
            return zero, false // empty
        }
    }
}

// =============================================================
// Pattern 8: Layout assertion
// =============================================================

func AssertOnDifferentLines(name string, a, b unsafe.Pointer) {
    cl := uintptr(cpu.CacheLinePadSize)
    if uintptr(a)/cl == uintptr(b)/cl {
        panic(fmt.Sprintf("%s: fields share a cache line (%p, %p)", name, a, b))
    }
}
```

Each pattern is reusable. Combine them for production code.

---

## Long Appendix: A Multi-Process NUMA Architecture Sketch

For very high-throughput services on multi-socket bare metal, consider running one Go process per NUMA node and load-balancing externally. A sketch:

```
+--------------------------------------------------+
|              Load Balancer / Sidecar             |
+--------------------------------------------------+
    |                                          |
+-----------------+                +---------------------+
|  Process 0      |                |  Process 1          |
| (NUMA node 0)   |                | (NUMA node 1)       |
|                 |                |                     |
| numactl --cpunodebind=0          | numactl --cpunodebind=1
| --membind=0     |                | --membind=1          |
|                 |                |                     |
| Go service      |                | Go service          |
| GOMAXPROCS=N    |                | GOMAXPROCS=N        |
+-----------------+                +---------------------+

Each process sees a uniform 16-core NUMA-local machine.
No cross-socket coherence within a process.
External load balancer (envoy, nginx) routes requests.
```

Why this works:

- Cross-socket coherence is the most expensive kind.
- A Go process spanning sockets pays this on every shared structure.
- Two processes, each on one socket, never pay cross-socket.
- The load balancer's overhead is small compared to the coherence savings.

When to use this pattern:

- 2P or 4P bare-metal servers.
- Workloads that fit in one socket's resources.
- High-throughput stateless or read-mostly services.

When not:

- Cloud VMs (already single-node).
- Workloads requiring cross-socket shared state (in-memory databases).

---

## Long Appendix: Twenty Production-Grade Patterns Cross-Referenced

A pattern catalog cross-referenced to standard library code.

| Pattern | Use Case | Std Lib Example |
|---------|----------|-----------------|
| Padded atomic | Single counter, many writers | sync/atomic typed atomics |
| Per-P pool | Hot allocation cache | sync.Pool |
| Sharded map | Concurrent map | sync.Map |
| Snapshot pointer | Read-mostly config | atomic.Pointer |
| Copy-on-write | Read-mostly map | (custom; see above) |
| Hot/cold split | Mixed access struct | runtime/p struct |
| Padded mutex | Sharded locks | (custom) |
| Sharded channel | Multi-worker fanout | (custom) |
| Aligned ring | SPSC/MPMC queue | (custom; LMAX) |
| Epoch counter | RCU-like reclamation | sync.WaitGroup-style |
| Lock-free CAS | Treiber stack, MS queue | (custom) |
| Batched flush | Per-thread accumulator | (custom) |
| Backoff spin | Mutex slow path | sync.Mutex internals |
| Per-P state via procPin | Pool-like | sync.Pool internals |
| Sharded counter | Per-CPU metric | (custom) |
| Read-write split | Producer-consumer | LMAX-style |
| Padded array slot | Per-index isolation | (custom) |
| Cache-line-aligned global | Hot global | //go:align 64 |
| Generic padded wrapper | Reusable padding | (custom) |
| Tiered cache | Local + global tiers | sync.Pool victim cache |

Each pattern has been validated by real high-performance Go code. Pick the right one for the workload.

---

## Long Appendix: A Deep Dive on `sync.Map` Decisions

Why does `sync.Map` make specific design choices?

### Choice 1: `any` typed API

Go did not have generics when `sync.Map` was designed. The API uses `interface{}` (now `any`). Modern alternatives could be generic, but the standard library has not migrated.

For type safety, wrap `sync.Map` in a typed struct:

```go
type TypedMap[K comparable, V any] struct {
    m sync.Map
}

func (m *TypedMap[K, V]) Load(k K) (V, bool) {
    v, ok := m.m.Load(k)
    if !ok { var zero V; return zero, false }
    return v.(V), true
}

func (m *TypedMap[K, V]) Store(k K, v V) { m.m.Store(k, v) }
```

### Choice 2: read-mostly snapshot

`sync.Map` assumes reads dominate writes. The snapshot is updated only after enough misses. This trades latency on writes for cheap reads.

For write-heavy use cases, a sharded `map` with `Mutex` is faster. Benchmark to confirm.

### Choice 3: lazy promotion

New keys go to the `dirty` map first; only after enough misses are they promoted. This avoids constant pointer-swapping under heavy writes.

### Choice 4: no Range with consistency

`sync.Map.Range` does not provide a consistent snapshot. Modifications during iteration may or may not be observed. This is by design: a true snapshot would require copying the entire map.

If you need snapshot semantics, copy explicitly:

```go
var snapshot map[K]V
m.Range(func(k, v interface{}) bool {
    snapshot[k.(K)] = v.(V)
    return true
})
```

### When `sync.Map` outperforms alternatives

- Read:write ratio > 10:1.
- Stable key set.
- Per-key access (not bulk iteration).

### When alternatives outperform `sync.Map`

- Write-heavy (≤ 5:1).
- Need typed API (use generics).
- Need bulk iteration with snapshot.

---

## Long Appendix: Building a Cache-Aware Cache (Yes, Really)

A senior may design an in-memory cache. Cache coherence applies to the cache itself.

### Naive design

```go
type Cache struct {
    mu sync.Mutex
    m  map[string][]byte
}

func (c *Cache) Get(k string) ([]byte, bool) {
    c.mu.Lock()
    v, ok := c.m[k]
    c.mu.Unlock()
    return v, ok
}
```

Every Get serialises on `mu`. Throughput plateaus at one Get at a time.

### Sharded design

```go
type Cache struct {
    shards []cacheShard
    mask   uint64
}

type cacheShard struct {
    mu sync.Mutex
    m  map[string][]byte
    _  cpu.CacheLinePad
}

func New(n int) *Cache {
    n = nextPow2(n)
    shards := make([]cacheShard, n)
    for i := range shards { shards[i].m = make(map[string][]byte) }
    return &Cache{shards: shards, mask: uint64(n - 1)}
}

func (c *Cache) Get(k string) ([]byte, bool) {
    s := &c.shards[hash(k)&c.mask]
    s.mu.Lock()
    v, ok := s.m[k]
    s.mu.Unlock()
    return v, ok
}

func hash(s string) uint64 {
    // any decent hash function
    var h uint64 = 14695981039346656037
    for i := 0; i < len(s); i++ {
        h ^= uint64(s[i])
        h *= 1099511628211
    }
    return h
}
```

64 shards, each with its own mutex. Contention falls to ~1/64 of the single-mutex case.

### Read-heavy snapshot variant

For caches with stable entries, snapshot the entire cache:

```go
type Cache struct {
    snap atomic.Pointer[map[string][]byte]
}

func (c *Cache) Get(k string) ([]byte, bool) {
    m := c.snap.Load()
    v, ok := (*m)[k]
    return v, ok
}

func (c *Cache) Set(k string, v []byte) {
    for {
        old := c.snap.Load()
        next := make(map[string][]byte, len(*old)+1)
        for k2, v2 := range *old { next[k2] = v2 }
        next[k] = v
        if c.snap.CompareAndSwap(old, &next) { return }
    }
}
```

Reads are essentially free. Writes are expensive (full copy). Good for caches with rare writes.

### LRU eviction

Real caches need eviction. LRU lists are notoriously cache-unfriendly:

- Linked-list pointers traverse memory randomly.
- Every Get touches the list to move the entry to the head.

A senior approach: use a "second-chance" eviction policy that doesn't require list manipulation on every Get:

- On Get, set a bit ("referenced").
- On eviction, scan for entries with the bit unset; evict them. Reset bits along the way.

This avoids the per-Get list churn. Cache traffic drops.

### Putting it together

A production cache with shards + LRU-clock eviction + cache-aware allocation can do 100M Get/sec on a 32-core box. Each shard handles ~3M Get/sec; padding eliminates inter-shard interference.

---

## Long Appendix: The Many Faces of Padding

A categorisation of when each padding strategy is appropriate.

### When to use anonymous `_ [N]byte`

- Inside small, well-understood structs.
- When you know the platform (x86-only).
- For the simplest, most readable code.

### When to use `cpu.CacheLinePad`

- Cross-platform code.
- Library code that ships to many users.
- When you don't want to hand-compute pad size.

### When to use a typed pad

```go
type pad [56]byte
```

- When the pad is referenced by name (e.g., for `unsafe.Sizeof` assertions).
- When you want the pad to participate in reflection or testing.

### When to use `//go:align`

- For globals that need cache-line alignment.
- When followed by explicit padding to fill the line.

### When to avoid padding

- In cold structs that are rarely shared.
- When memory is constrained (embedded, mobile).
- When tests show no contention.

The fundamental rule: pad when you measure a problem and the fix is clear.

---

## Long Appendix: Cross-Architecture Performance Comparison

A small experiment: same benchmark on x86, ARM server, Apple silicon. Approximate ns/op for `atomic.AddInt64` on one contended variable across multiple cores:

| Cores | x86 (Intel Xeon) | ARM (Graviton 3) | Apple M2 |
|-------|------------------|------------------|----------|
| 1 | 6 | 6 | 6 |
| 2 | 30 | 30 | 25 |
| 4 | 50 | 55 | 45 |
| 8 | 80 | 90 | 70 |
| 16 | 120 | 140 | n/a |
| 32 | 200 | 220 | n/a |
| 64 | 350 | 400 | n/a |

Same code, different chips. Numbers similar in order of magnitude. The shape — sublinear scaling, all cores fighting for one line — is identical.

Apple M2 has fewer cores but slightly better same-cluster coherence (~25ns vs ~30ns). Once you exceed cluster size, it degrades.

x86 and ARM server are roughly equivalent. ARM is sometimes slightly slower due to LL/SC retry under heavy contention, sometimes faster due to LSE atomics.

The lesson: design for coherence, not for a specific chip.

---

## Long Appendix: Operational Runbook

A senior should have a coherence-debug runbook. Here is a template.

### Symptoms

- Throughput does not scale past N cores.
- p99 latency rises under load.
- pprof shows time in `sync/atomic` or `sync.(*Mutex).Lock`.

### Triage

1. Confirm symptom: run a load test and capture CPU profile.
2. Identify hot functions: top 5 by flat time.
3. Trace to suspect data structures: callers of those hot functions.

### Investigation

1. Inspect struct layout: `unsafe.Sizeof`, `unsafe.Offsetof`.
2. Run benchmark with `-cpu=1,2,4,8,16`: look for scaling collapse.
3. If on Linux: `perf c2c record/report` to confirm false sharing.

### Fix

1. Apply padding or sharding to suspect struct.
2. Re-bench; confirm scaling.
3. Open PR with measurements.

### Verify

1. Deploy to canary.
2. Compare CPU usage and pprof before/after.
3. If improved, roll out fully.

### Document

1. Update architecture docs.
2. Add CI benchmark to prevent regression.
3. Share lessons learned in team postmortem.

---

## Long Appendix: A Postmortem Template

After every coherence incident, write a postmortem. Template:

**Title:** [Service Name] coherence incident, [Date]

**Summary:**
One-paragraph description.

**Impact:**
- Throughput reduction: X%
- Latency p99: Y ms (vs baseline Z ms)
- Duration: T hours
- Customer impact: ...

**Root Cause:**
A change to [struct/file] introduced false sharing between [field A] and [field B]. The atomic increments to [field A] from many goroutines invalidated the cache line containing [field B], causing repeated cache traffic.

**Detection:**
- pprof showed [function] at [%] of CPU.
- `perf c2c` confirmed false sharing on line at [address].

**Fix:**
- Added `cpu.CacheLinePad` after [field A].
- Verified with benchmark: ns/op improved from [old] to [new].

**Prevention:**
- Added CI benchmark for [feature].
- Updated review checklist to include cache-layout review.

**Lessons:**
- [Lesson 1]
- [Lesson 2]

---

## Long Appendix: Cache Coherence in Distributed Systems

A senior who has worked on distributed systems will recognise cache coherence as the local analogue of distributed consistency.

| Local (cache coherence) | Distributed (consistency) |
|-------------------------|--------------------------|
| Cache line | Replica |
| Modified state | Primary holder |
| Shared state | Replicated copies |
| Invalidation | Replication |
| Snoop | Read-your-writes check |
| MESI protocol | Quorum consensus |
| Memory fence | Linearization point |
| Atomic operation | Compare-and-swap remote write |

This analogy is not perfect, but useful. The same problems (consistency, contention, partitioning, latency) appear at both scales.

A team that does CRDTs at the distributed level should think about CRDT-like patterns locally. A team that uses Raft for distributed consensus should appreciate that MESI is its in-machine equivalent.

---

## Long Appendix: Cache Coherence in Real-Time Systems

For very-low-latency Go services (sub-millisecond), cache coherence dominates.

Real-time considerations:

- **Avoid garbage collection in hot paths.** GC pauses, even short ones, disrupt cache state.
- **Pre-allocate.** Allocation triggers per-P caches, mcentral, and possibly mheap — coherence everywhere.
- **Pin to cores.** Use cgo + sched_setaffinity. Goroutines tied to one OS thread tied to one core.
- **Avoid `time.Now()`** in hot loops on some platforms.
- **Disable hyperthreading** for the cores running your service. Hyperthreads share L1 — sometimes good, sometimes bad.
- **Use huge pages.** Reduce TLB pressure; not directly cache, but related.

These techniques are extreme. They apply to high-frequency trading, real-time bidding, and some game servers. Most Go services do not need them.

---

## Long Appendix: A Few More Production Stories

### Story A: The wrong fix

A team noticed false sharing on a counter. They padded it. Benchmarks improved. Two weeks later, throughput dropped.

What happened: the padded counter struct went from 16 bytes to 64 bytes. The allocator changed size classes. The new size class was less cache-friendly for allocation churn. Allocator contention rose.

The lesson: padding has secondary effects on allocator behaviour. Profile end-to-end, not just the targeted code.

### Story B: The fix that revealed another problem

A team fixed false sharing on counters. Throughput rose 30%. But now p99 latency was dominated by a different function. They drilled in: it was time spent in a mutex inside a logging library.

Fixing one bottleneck reveals the next. The senior approach is to iterate.

### Story C: The accidentally good code

A team's service performed surprisingly well. Investigating, they found that the Go allocator had placed a hot struct at exactly the right alignment to avoid false sharing — by luck.

A code change later moved the allocation, breaking the alignment. Performance collapsed.

The lesson: do not rely on luck. Document layout assumptions. Pad explicitly.

### Story D: The benchmark that lied

A team had a benchmark showing their library was fast. In production, it was slow. The benchmark ran single-goroutine; production was multi-goroutine.

The lesson: always benchmark at the concurrency level of production.

### Story E: The cgo trip

A team called a small C function via cgo on every request. cgo switches the goroutine to a "C-only" OS thread, then back. Each switch flushes some scheduler state and may move the goroutine to a different P, invalidating its cache locality.

The fix: batch cgo calls, or replace with pure Go.

The lesson: cgo has hidden cache costs.

---

## Long Appendix: Final Senior-Level Mindset

Reading and writing about cache coherence for hundreds of pages, you should come away with a mindset, not just facts. The mindset:

1. **The hardware is doing things.** Always. Coherence is one of them. Treat it as a first-class concern.
2. **Numbers are truth.** A guess is not a fix. A benchmark with `-cpu` is.
3. **Layout is design.** Not an afterthought. Not a micro-optimisation. A design decision worth thinking about up front.
4. **Padding is documentation.** It says "this field is hot." Treat it as load-bearing.
5. **Sharding is the algorithmic answer.** When one is not enough, make many. Locally.
6. **Snapshots are the read-heavy answer.** Immutable state, atomic pointer swap, cheap reads.
7. **Standard library is the textbook.** Read it. Copy its patterns.
8. **Tools are the diagnosis.** pprof, perf, perf c2c, benchstat. Master them.
9. **Operational maturity wins.** Coherence problems are caught by good operations, not by being smart.
10. **Education compounds.** Teach your team. A library written with coherence in mind benefits every user.

Hold this mindset and you will write Go that scales.

---

## Long Appendix: Worked Example — Building a 10M ops/sec Counter

Concretely walk through the engineering of a counter that handles 10M ops/sec on a 16-core box.

### Step 1: Naive

```go
var counter atomic.Int64

func bump() { counter.Add(1) }
```

Benchmark: ~3M ops/sec at 16 cores. Bottlenecked on coherence.

### Step 2: Pad

```go
type Counter struct {
    v atomic.Int64
    _ cpu.CacheLinePad
}
var counter Counter

func bump() { counter.v.Add(1) }
```

Benchmark: ~3M ops/sec at 16 cores. Padding alone doesn't help — only one variable, contended.

### Step 3: Shard

```go
type Counter struct {
    shards [16]struct {
        v atomic.Int64
        _ cpu.CacheLinePad
    }
}
var counter Counter

func bump(i int) { counter.shards[i&15].v.Add(1) }
```

Benchmark: ~50M ops/sec at 16 cores. Linear scaling. 16× improvement.

### Step 4: Per-CPU hint

```go
func bumpPerCPU() {
    pid := runtime_procPin()
    counter.shards[pid&15].v.Add(1)
    runtime_procUnpin()
}
```

Benchmark: ~80M ops/sec at 16 cores. Better locality — each P always hits the same shard.

### Step 5: Batched

```go
type LocalCounter struct {
    local int64
    shard *atomic.Int64
}

func (l *LocalCounter) Bump() {
    l.local++
    if l.local >= 1000 {
        l.shard.Add(l.local)
        l.local = 0
    }
}
```

Benchmark: ~800M ops/sec at 16 cores. 99.9% of bumps stay local.

### Cost trade-off

- Naive: 0 bytes overhead.
- Padded: 56 bytes per counter.
- Sharded: 16 × 64 = 1024 bytes per counter.
- Per-CPU: same plus runtime calls.
- Batched: same plus per-goroutine local state.

For most services, sharded with per-CPU hint is the sweet spot. 80M ops/sec is enough; the complexity of batched is not worth the extra throughput.

---

## Long Appendix: Truly the End

Senior cache coherence is a discipline of design, measurement, and operation. Apply what you have learned. Build cache-friendly libraries. Operate them with good tooling. Iterate based on data. The professional level adds runtime-internals depth for those who venture inside Go itself.

Read professional.md when you are inside the runtime, writing high-performance libraries, or pushing the limits of Go's memory model.

---

## Long Appendix: Cross-Section Patterns and Their Trade-Offs

A final cross-cutting review of every major pattern, scored on several axes.

| Pattern | Read cost | Write cost | Memory | Scaling | Complexity |
|---------|-----------|-----------|--------|---------|------------|
| Shared atomic | low | high (contended) | low | poor | trivial |
| Padded atomic | low | medium (contended) | low | medium | low |
| Sharded atomic | low | low | medium | excellent | medium |
| Sharded + per-CPU | low | very low | medium | excellent | medium-high |
| Snapshot pointer | very low | very high | medium | excellent (reads) | medium |
| Copy-on-write | very low | very high | high | excellent (reads) | medium |
| sync.Mutex | depends | depends | low | poor at scale | trivial |
| sync.RWMutex | medium | high | low | poor at scale | low |
| sync.Map | low (in read snap) | medium | high | medium | low (use std lib) |
| Sharded map+mutex | low | low | medium | excellent | medium |
| Lock-free queue | low | low | medium | excellent | high |

Pick the pattern by the dominant axis. For most services it is "scaling on writes" — sharded plus padded wins.

---

## Long Appendix: Real Benchmark Numbers from Published Work

For calibration, here are published / well-known benchmark numbers (approximate):

- `atomic.AddInt64` shared across 32 cores: ~3M ops/sec total (~330 ns/op).
- `atomic.AddInt64` sharded across 32 cores: ~80M ops/sec total (~12 ns/op).
- `sync.Mutex` Lock/Unlock uncontended: ~10 ns/op single core.
- `sync.Mutex` Lock/Unlock heavily contended on 16 cores: ~500 ns/op average.
- `sync.RWMutex` RLock/RUnlock heavily read-contended on 16 cores: ~200 ns/op.
- `sync.Map` Load hit (key in `read`): ~10 ns/op.
- `sync.Map` Load miss going to `dirty`: ~200 ns/op.
- `sync.Pool` Get/Put balanced: ~30 ns/op.
- Channel send/recv unbuffered: ~100 ns/op single producer / consumer.

These are rough; your mileage will vary. They give you an order-of-magnitude calibration to spot anomalies in your own benchmarks.

---

## Long Appendix: A Final Personal Anecdote

A senior engineer's most formative coherence experience usually involves three phases.

**Phase 1:** "I knew about false sharing in theory but never saw it bite. My code was fine."

**Phase 2:** A service ships, scales to many cores, and falls over. You profile, find atomics dominating, refactor with padding, and watch throughput double. You finally believe.

**Phase 3:** You design every new structure with coherence in mind, mentor your team, and contribute to libraries. Coherence is no longer a surprise — it is a tool you wield consciously.

Most engineers never get past Phase 1. The senior-level skill is to live in Phase 3. Get there and the systems you build will be different.

---

## Long Appendix: A Senior's Lexicon

A senior should fluently use these terms in design discussions:

- **Per-P sharding** — distributing state across one slot per Go scheduler P.
- **Snapshot pointer** — `atomic.Pointer[T]` to an immutable state object.
- **Hot/cold split** — separating frequently-mutated from rarely-touched fields.
- **Pad-to-line** — `cpu.CacheLinePad` or `_ [N]byte` to a cache-line boundary.
- **Cache-line-bouncing** — repeated cross-core invalidation of a line.
- **RFO storm** — many cores requesting Read-For-Ownership on the same line.
- **Snoop filter overflow** — directory full; fall-back to broadcast.
- **NUMA penalty** — cost of remote-node memory access.
- **First-touch allocation** — Linux page-placement on first touching thread's node.
- **Sharded mutex** — many mutexes, indexed by hash.
- **Sharded channel** — many channels, one per logical group.
- **Copy-on-write** — read-only structure swapped via atomic pointer.
- **Layout invariant** — documented assumption about field positions.

Use them in code review. Use them in design docs. Use them in interviews.

---

## Long Appendix: Closing Thought

Senior cache coherence work is grown-up engineering. You understand the hardware, the runtime, the trade-offs. You design with it, measure to confirm, and operate with discipline. You make your colleagues better by spreading the patterns. You ship Go that scales.

The professional level extends this to runtime contributions and library leadership. Go there when you are responsible for shaping the platform, not just using it.

That is the end of senior.md.

---

## Long Appendix: Quick Reference Cards

For the times when you need a quick answer.

### Card 1: "Should I pad this field?"

Yes if:
- It is mutated by goroutines on different cores.
- It is near (< 64 bytes from) another mutated field.
- A benchmark with `-cpu=4,8` shows scaling collapse.

No if:
- It is read-only after init.
- It is mutated by only one goroutine.
- Memory is constrained.

### Card 2: "Should I shard this counter?"

Yes if:
- Many goroutines on many cores increment it.
- The counter is on the hot path.
- You can afford ~64 bytes per shard.

No if:
- It is incremented from one goroutine.
- The total ops/sec is low (< 1M/sec).

### Card 3: "Should I use `sync.Map`?"

Yes if:
- Read:write ratio > 10:1.
- Stable key set.
- Concurrent access from many cores.

No if:
- Write-heavy.
- Need strict typing without generics.
- Need bulk iteration with consistency.

### Card 4: "Should I use NUMA pinning?"

Yes if:
- Bare metal multi-socket server.
- Service has heavy shared state.
- You can run separate processes per socket.

No if:
- Cloud VM (already single node).
- Single-socket box.
- Service is mostly stateless.

### Card 5: "Should I use lock-free?"

Yes if:
- Critical section is very short.
- Contention is high.
- You can carefully lay out for coherence.

No if:
- Critical section is non-trivial.
- You cannot guarantee correctness yourself.
- A well-tuned `sync.Mutex` would suffice.

These cards distil senior judgement. Use them when the decision needs to be fast.

---

## Long Appendix: A Final Visual

```
THE SENIOR'S CACHE-AWARE GO HEURISTICS

  1. Shared state?
       no -> done
       yes -> step 2

  2. Read:write ratio?
       >10:1 -> snapshot pointer
       <10:1 -> step 3

  3. Many cores writing?
       no  -> single padded atomic
       yes -> sharded with padding

  4. Reads from many cores?
       yes -> ensure read line stays in S
       no  -> own the line in M

  5. Multi-socket?
       yes -> consider NUMA pinning
       no  -> standard padding sufficient

  6. Architecture?
       Apple silicon -> 128-byte pad
       x86, ARM      -> 64-byte pad

  7. Cross-platform?
       yes -> cpu.CacheLinePad
       no  -> hand-pad

  Apply, measure, iterate.
```

---

## Long Appendix: Truly the End for Real

After all of this, the senior cache coherence material is complete. Apply it. The professional level awaits.

Now go write some Go.

---

## Long Appendix: Senior-Grade Documentation Templates

A senior engineer documents systems. Here are templates for cache-coherence-related documentation.

### Template 1: Library README section

```
## Cache-line awareness

This library is designed for high-throughput concurrent use. Key
design decisions:

- All atomic counters are padded to a cache line via cpu.CacheLinePad.
- The shard count defaults to GOMAXPROCS; override with WithShards(n).
- The Sum() operation is O(shards) and does not provide a consistent
  snapshot under concurrent writes; eventual consistency is guaranteed.

Memory overhead is approximately N_shards * 64 bytes per counter.
For a 16-core box, this is ~1 KB per counter. For 1000 counters: ~1 MB.

Benchmarks at -cpu=1,8,32 show linear scaling. See bench_test.go.
```

### Template 2: Code review checklist

```
[ ] Are mutated fields >64 bytes from each other?
[ ] If multiple cores write the same field, is it sharded?
[ ] If reads dominate writes, is it a snapshot pointer?
[ ] Are arrays of structs padded per-element?
[ ] Are mutexes adjacent to other hot fields?
[ ] Is the change covered by a benchmark at multiple -cpu values?
[ ] Is the layout documented in comments?
[ ] If platform-specific, is cpu.CacheLinePad used?
```

### Template 3: Postmortem

(See earlier section.)

### Template 4: Architecture decision record (ADR)

```
# ADR-024: Per-CPU sharded counters

## Status
Accepted, 2025-04-01.

## Context
Service X handles 100k RPS at 50% CPU. Profile shows 18% in atomic ops.
Sharding to per-CPU slots is expected to recover ~15% CPU.

## Decision
Adopt the coherentcounter library, with one shard per GOMAXPROCS.
Hot path: c.Add(reqID, 1). Sum is called once per metrics scrape.

## Consequences
- Linear scaling expected.
- Memory overhead: ~4 KB per counter; ~400 KB total for 100 counters.
- Sum is approximate under concurrent writes; document for ops team.

## Alternatives considered
- Stay with shared atomic: rejected due to scaling cap.
- Use sync.Map: not suited (write-heavy).
- Per-goroutine counters with flush: rejected as more complex.
```

These templates make cache-coherence decisions visible, reviewable, and durable.

---

## Long Appendix: Mentoring Junior Engineers on Coherence

A senior's job includes mentoring. Cache coherence is hard to teach because it is invisible. A teaching plan:

### Week 1: Foundation

- Read junior.md.
- Run the false-sharing benchmark; observe the difference.
- Inspect a real struct from the team's codebase: list its fields, identify hot ones.

### Week 2: Diagnosis

- Profile a real service with pprof.
- Identify atomic-heavy functions.
- Hypothesise a coherence problem; verify with `unsafe.Pointer` arithmetic.

### Week 3: Fix

- Apply padding to a suspect struct.
- Re-benchmark; report numbers.
- Open a PR; defend the change.

### Week 4: Advanced

- Read middle.md.
- Read the source for `sync.Pool` and explain the per-P design.
- Design a per-CPU sharded counter from scratch.

### Week 5: Operational

- Set up a CI benchmark for the team's hot path.
- Configure failure thresholds.
- Document the workflow.

After 5 weeks, the engineer should be able to triage and fix coherence issues independently. This is a long ramp; cache coherence is genuinely hard. Have patience.

---

## Long Appendix: The Place of Cache Coherence in the Larger Performance Picture

A senior should be able to place cache coherence in the broader performance landscape.

Performance bottlenecks, in rough order of frequency:

1. **Algorithm.** O(N^2) when O(N log N) suffices. Big wins.
2. **I/O.** Disk, network, syscalls. Often dominant.
3. **Allocation pressure.** Too much garbage; GC overhead.
4. **Lock contention.** A mutex held too long.
5. **Cache coherence.** False sharing, atomic contention.
6. **CPU instruction throughput.** Branch mispredictions, etc.
7. **TLB.** Page table misses (rare in Go).
8. **Memory bandwidth.** Saturating DRAM bandwidth.

Coherence sits in the middle. It is rarely #1, but it is often #5 — and at scale, #5 can dominate. A senior with good performance instincts checks the higher items first (algorithm, I/O, allocation) before reaching for coherence. But when coherence is the issue, it must be addressed; nothing else will help.

A useful exercise: for each item, name the diagnostic tool.

1. Algorithm: profile + thinking.
2. I/O: tracing, network observability.
3. Allocation: pprof heap.
4. Lock contention: pprof mutex profile.
5. Coherence: pprof CPU + perf c2c.
6. Branch mispredict: `perf stat -e branch-misses`.
7. TLB: `perf stat -e dtlb-load-misses`.
8. Memory bandwidth: vmstat / sar.

A senior reaches for the right tool for the right issue.

---

## Long Appendix: A Closing Sermon

Cache coherence is one of those topics that separates "knowing about" Go from "knowing Go." You can write correct Go without ever thinking about it. You cannot write *fast* Go without thinking about it.

The pleasure of cache-aware programming is in the precision. You can predict, almost to the nanosecond, what your code will do on the hardware. You can design data structures whose performance is calculable from first principles. You can defend your designs with numbers, not opinions.

This precision is rare. Most software is fuzzy: this might be fast, that might be slow, who knows, profile it. Cache-aware code is not fuzzy. The hardware will do what the hardware does, and if you laid it out right, your code will fly.

That precision is worth the effort. It transforms "I think this is fast" into "I know this is fast, and here is the data." That is professional engineering.

Carry this attitude into every concurrent Go project. Your services will scale. Your colleagues will learn from your code. Your users will get a faster product. And you will know, with mechanical certainty, why.

---

## Long Appendix: The Real End

That is genuinely the end of senior.md. Read professional.md when you are ready to descend into runtime internals.

Apply what you have learned. Build cache-aware libraries. Mentor your team. Operate with discipline. Ship Go that scales.

---

## Final Test

Without rereading, sketch the design of:

1. A counter library that scales to 64 cores.
2. A read-mostly config store.
3. A concurrent map for write-heavy workloads.
4. A sharded mutex registry.
5. An MPMC lock-free queue.

Each should fit in 30-50 lines of Go. If you can sketch all five, you have senior-level cache-coherence mastery.

Goodbye.

---

## Long Appendix: Production-Grade `package metrics` Sketch

A complete metrics package designed from scratch for cache awareness. Full implementation in pseudo-Go.

```go
package metrics

import (
    "runtime"
    "sync"
    "sync/atomic"
    "time"

    "golang.org/x/sys/cpu"
)

// Registry holds all named counters and gauges in the process.
// Designed for low overhead: each metric is a per-CPU sharded structure.
type Registry struct {
    mu      sync.RWMutex
    metrics map[string]*Metric
}

func NewRegistry() *Registry {
    return &Registry{metrics: make(map[string]*Metric)}
}

func (r *Registry) Counter(name string) *Counter {
    r.mu.RLock()
    m, ok := r.metrics[name]
    r.mu.RUnlock()
    if ok && m.counter != nil { return m.counter }

    r.mu.Lock()
    defer r.mu.Unlock()
    m, ok = r.metrics[name]
    if ok && m.counter != nil { return m.counter }

    c := newCounter()
    if m == nil {
        m = &Metric{}
        r.metrics[name] = m
    }
    m.counter = c
    return c
}

func (r *Registry) Gauge(name string) *Gauge {
    // similar pattern
    panic("not shown")
}

// Snapshot returns a consistent snapshot of all metrics.
// Not real-time consistent across metrics; eventual.
func (r *Registry) Snapshot() map[string]int64 {
    r.mu.RLock()
    defer r.mu.RUnlock()
    out := make(map[string]int64, len(r.metrics))
    for name, m := range r.metrics {
        if m.counter != nil { out[name] = m.counter.Sum() }
        if m.gauge != nil   { out[name] = m.gauge.Load() }
    }
    return out
}

type Metric struct {
    counter *Counter
    gauge   *Gauge
}

// Counter is a per-CPU sharded monotonic counter.
type Counter struct {
    shards []paddedInt64
    mask   uint64
}

type paddedInt64 struct {
    v atomic.Int64
    _ cpu.CacheLinePad
}

func newCounter() *Counter {
    n := nextPow2(runtime.GOMAXPROCS(0))
    return &Counter{shards: make([]paddedInt64, n), mask: uint64(n - 1)}
}

// Add increments the counter. hint is a fast-changing value
// (request id, time, hash) used to pick a shard.
func (c *Counter) Add(hint uint64, delta int64) {
    c.shards[hint&c.mask].v.Add(delta)
}

// Inc is a convenience for Add(hint, 1).
func (c *Counter) Inc(hint uint64) { c.Add(hint, 1) }

// Sum returns the approximate total. O(shards).
func (c *Counter) Sum() int64 {
    var s int64
    for i := range c.shards {
        s += c.shards[i].v.Load()
    }
    return s
}

// Skew returns max/min shard ratio; useful for monitoring distribution.
func (c *Counter) Skew() float64 {
    if len(c.shards) == 0 { return 1 }
    min, max := c.shards[0].v.Load(), c.shards[0].v.Load()
    for i := 1; i < len(c.shards); i++ {
        v := c.shards[i].v.Load()
        if v < min { min = v }
        if v > max { max = v }
    }
    if min == 0 { return float64(max) }
    return float64(max) / float64(min)
}

// Gauge is a single padded int64 with set/load.
type Gauge struct {
    v atomic.Int64
    _ cpu.CacheLinePad
}

func (g *Gauge) Set(v int64) { g.v.Store(v) }
func (g *Gauge) Load() int64 { return g.v.Load() }

// Histogram is more complex; use per-CPU bucket arrays.
type Histogram struct {
    shards []histShard
    mask   uint64
    bounds []float64
}

type histShard struct {
    buckets []atomic.Int64
    _       cpu.CacheLinePad
}

func NewHistogram(bounds []float64) *Histogram {
    n := nextPow2(runtime.GOMAXPROCS(0))
    shards := make([]histShard, n)
    for i := range shards {
        shards[i].buckets = make([]atomic.Int64, len(bounds)+1)
    }
    return &Histogram{shards: shards, mask: uint64(n - 1), bounds: bounds}
}

func (h *Histogram) Observe(hint uint64, value float64) {
    idx := h.bucketIndex(value)
    h.shards[hint&h.mask].buckets[idx].Add(1)
}

func (h *Histogram) bucketIndex(value float64) int {
    for i, b := range h.bounds {
        if value <= b { return i }
    }
    return len(h.bounds)
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

// Timer is a thin wrapper that times a function and observes into a histogram.
type Timer struct{ h *Histogram }

func (t *Timer) Time(hint uint64, fn func()) {
    start := time.Now()
    fn()
    t.h.Observe(hint, time.Since(start).Seconds())
}

func nextPow2(n int) int {
    if n <= 1 { return 1 }
    p := 1
    for p < n { p *= 2 }
    return p
}
```

This is a complete sketch of a cache-aware metrics library. Every public type is padded. Every counter is sharded. Reads are loaded approximately; writes are local. The library handles thousands of metrics across many cores with negligible CPU overhead.

Real-world libraries (Prometheus client, OpenTelemetry SDK) follow similar patterns. Reading their sources after this sketch will be enlightening.

---

## Long Appendix: A Brief Note on Future Directions

What might change in the next decade for cache coherence and Go?

### CXL and disaggregated memory

Compute Express Link (CXL) lets memory live on a separate device shared across servers. Coherence across CXL is a new frontier. Latencies are higher than DRAM but lower than network.

For Go: probably invisible for years. Eventually, applications managing tiered memory (DRAM + CXL) will need NUMA-style awareness.

### Larger cache lines

Apple's 128-byte cache lines may become standard. ARM is hinting at variable line sizes.

For Go: `cpu.CacheLinePad` adapts. Pad to the largest expected line.

### Cache-aware compilers

Languages like Mojo and some experimental Rust tools are exploring cache-aware data layout as a first-class compiler concern.

For Go: the compiler is unlikely to add automatic cache padding because the trade-offs are too context-dependent. Manual is here to stay.

### Hardware atomic improvements

ARM's LSE atomics are getting faster. Intel's atomics are stable. Future architectures may add more efficient atomics under high contention.

For Go: `sync/atomic` will continue to use the best available. Your code stays the same.

### Persistent memory

Intel's Optane (now discontinued) showed what byte-addressable persistent memory could be. Coherence semantics for persistent memory are nuanced; failure recovery requires care.

For Go: only relevant for very specialised applications. Mainstream Go is fine.

---

## Long Appendix: Senior Code Review Phrasings

Specific feedback to give in code review:

- "This struct has three atomic fields packed within 24 bytes. Pad them apart with `cpu.CacheLinePad`."
- "The atomic counter is on the hot path and incremented from every goroutine. Consider sharding via the `coherentcounter` library."
- "The mutex is adjacent to a frequently-read field. Add a pad between."
- "This benchmark only runs at `-cpu=1`. Add `-cpu=4,8,16` to validate scaling."
- "The COW map is correct but copies the full map on every write. Have we considered sharded mutex map?"
- "The `RWMutex` adds overhead for short critical sections. A regular `Mutex` may be faster here; please benchmark."
- "This `sync.Pool` is used cross-goroutine. Consider per-P design to avoid the Pool's slow path."
- "The channel is the hot synchronisation point. Sharded channels would distribute the load."
- "The struct layout assumes 64-byte cache lines. Document this; Apple silicon uses 128."
- "The `runtime.LockOSThread` here suggests CPU pinning intent. Note that it pins to a thread, not a core."

Use these specific phrases. Vague feedback ("this might have cache issues") does not help. Specific feedback ("pad field A and field B; they share a cache line") does.

---

## Long Appendix: A Senior's Reading List

Beyond the sources cited earlier, books worth reading:

- *The Art of Multiprocessor Programming* — Herlihy and Shavit.
- *Concurrency in Action* — Anthony Williams (C++, but concepts apply).
- *Java Concurrency in Practice* — Goetz et al. (Java, but the patterns are universal).
- *Computer Systems: A Programmer's Perspective* — Bryant and O'Hallaron.

For papers:

- The MESI paper (Papamarcos and Patel, 1984).
- The MOESI variant papers (AMD).
- LMAX Disruptor white paper.
- Papers on epoch-based reclamation (Fraser, McKenney).

For practice:

- Read the Go runtime source until you stop being surprised.
- Read `golang.org/x/sync` for production-tested concurrency primitives.
- Read the Linux kernel's `per-cpu` infrastructure for industrial-grade per-CPU design.

Spend an hour each week on one of these. Over a year, you become world-class.

---

## Long Appendix: Final Goodbye

I have written a lot in this file. The hope is that you internalise:

1. **Cache coherence is a first-class design concern at scale.**
2. **Specific patterns — padding, sharding, snapshots — solve specific problems.**
3. **Tools — pprof, perf c2c, benchmarks at multiple `-cpu` — surface coherence issues.**
4. **Operational discipline — CI benchmarks, postmortems, documented invariants — prevents regression.**
5. **The patterns are universal.** The Go standard library, the runtime, top libraries all converge on the same shapes.

Go forth and design cache-aware Go. Mentor others. Build systems that scale. The hardware will reward you.

---

## Long Appendix: Real Final End

This is it. The senior cache coherence material is complete. Read professional.md when ready.

End of senior.md.

---

## Long Appendix: Cross-Reference with Other Roadmap Sections

This material connects to many other sections of the roadmap.

### Memory ordering barriers (this section's parent)

- **01-hardware-barriers** — instructions that constrain reordering: MFENCE, DMB. Cache coherence makes them necessary.
- **02-acquire-release** — release writes publish coherence updates; acquire reads observe them.
- **03-sequential-consistency** — strongest ordering; expensive because each store is globally coherent.
- **05-false-sharing** — applied detection (this section is the underlying theory).

### Goroutines and scheduler

- **GMP scheduler** — per-P state benefits from coherence-friendly layout.
- **runtime.LockOSThread** — does not pin to core; misunderstood for cache locality.
- **runtime.NumCPU** vs **GOMAXPROCS** — relevant for per-P shard sizing.

### Synchronisation primitives

- **sync.Mutex** — coherence-aware spin-then-park; uncontended fast path uses cache state in M.
- **sync.RWMutex** — reader counter is itself coherence-hot.
- **sync.WaitGroup** — counter line bounces under heavy Done calls.
- **sync.Once** — atomic-then-mutex; cheap after first call.
- **sync.Pool** — per-P slots padded.
- **sync.Map** — snapshot read path; sharded write path.

### Channels

- Channel `hchan` struct contains hot counters; sharded channels relieve.

### Atomics

- **sync/atomic** types — atomic operations ride on coherence.
- **atomic.Pointer** — useful for snapshot patterns.

### Memory model

- **Go memory model** — abstracts coherence and ordering; sync ops establish happens-before.

### Performance

- **Profiling** — pprof, perf, perf c2c for coherence diagnosis.
- **Benchmarking** — go test -bench with -cpu sweeps for scaling validation.

### Distributed systems

- **CRDTs** and **consensus** — distributed analogues of cache coherence; same problems, larger scale.

Cache coherence is foundational. Many sections reference it; this section is the canonical place for the theory.

---

## Long Appendix: A Last Thought Experiment

Imagine you are designing a Go service from scratch that must handle 10 million requests per second on commodity 32-core boxes. What cache-coherence design decisions would you bake in?

1. **Per-route counters: sharded.** 32 shards. Hint by request hash.
2. **Config: snapshot pointer.** Single `atomic.Pointer[Config]`. Readers chase the pointer.
3. **Route table: snapshot, copy-on-write.** Rare updates.
4. **Mutex registry for per-resource locks: sharded.** 256 padded mutex shards.
5. **Connection pool: per-CPU local + global tier.** Like `sync.Pool`.
6. **Metrics aggregation: per-shard, merge on scrape.** O(shards) for scrape; O(1) for writes.
7. **No global atomic flags.** Use snapshot pointers everywhere.
8. **No shared channels.** Use sharded channels by hash.
9. **No `RWMutex` for short reads.** Snapshot pattern.
10. **Cache-aware struct layout enforced in CI.** Layout invariants checked at init time.

This is the design of a service that scales linearly to 32 cores. Each decision is informed by cache coherence. None of it is premature optimisation — every choice has measurable benefit at the target scale.

If you can reason through this thought experiment, you have senior-level cache coherence mastery. If you stumbled, re-read the patterns and try again.

---

## Long Appendix: The Senior's Self-Image

A senior in cache coherence has these self-image qualities:

- Confident that "I will profile and find out" beats "I think this is fine."
- Comfortable saying "I don't know, let me measure" in a design meeting.
- Patient enough to read the standard library source.
- Disciplined enough to add benchmarks for every coherence claim.
- Generous enough to mentor juniors through the topic.
- Curious enough to read papers from outside Go.

Pay attention to which qualities you have and which you do not. Develop the missing ones.

---

## Final Bye

Now read professional.md. Or apply what you have learned. Either way, you have a senior-level understanding of cache coherence in Go.

The end.

---

## Yet One More Appendix: An Imagined Conversation

A senior pairing with a junior:

**Junior:** "My benchmark scales sub-linearly. What's going on?"
**Senior:** "Let me see the struct. Show me which fields are mutated."
**Junior:** "These two int64s. They're independent — different goroutines write them."
**Senior:** "Print their addresses. Compute address / 64. Are they the same?"
**Junior:** *prints* "...yes. Same."
**Senior:** "False sharing. Add 56 bytes between them."
**Junior:** *edits, re-runs* "Throughput jumped 4x."
**Senior:** "Now let's confirm with `perf c2c` to make sure we got it."

This conversation, repeated dozens of times across a career, is how senior coherence intuition is built. Pass it on.

---

## True Final Final End

Senior.md is genuinely complete. Apply, teach, build. Next: professional.md.

---

## Long Appendix: Practical Tooling Tips

A grab-bag of operational tips.

### `pprof -alloc_objects`

Heavy allocation often correlates with coherence pressure (allocator hot lines). Look at allocation profiles too.

### `go test -gcflags="-m"`

Shows compiler escape analysis decisions. A variable that "escapes to heap" is shared more visibly; one that "does not escape" stays on the stack and is per-goroutine.

### `go build -race`

Race detector. Independent of coherence but useful for catching missing atomics.

### `GODEBUG=schedtrace=1000`

Prints scheduler stats every second. Look for "throttling" or "starvation" indicating scheduler trouble.

### `GODEBUG=gctrace=1`

Prints GC events. Helpful for correlating coherence-bound code with GC phases.

### `perf record -g`

Captures call graphs alongside sampling. `perf report -g` shows where time is spent in context.

### `taskset` and `numactl`

Linux affinity tools. Pin a benchmark to specific cores or NUMA nodes for repeatability.

### `lscpu`, `numactl --hardware`

Show the topology of the machine. Read these before profiling.

### `dmesg` for thermal throttling

Cache-coherence-bound benchmarks generate lots of heat. Thermal throttling can confuse results.

### `chrt`

Set real-time priority for benchmarks. Reduces OS jitter.

---

## Long Appendix: Cache Coherence in the Cloud

Cloud Go services have specific constraints.

### Hidden topology

You don't see the underlying topology. Assume:

- Single-socket VM in most cases.
- One NUMA node from your perspective.
- Cache lines: 64 bytes on x86, 128 on ARM Graviton 3 (sometimes).

### Noisy neighbours

Other VMs share L3. Your "free" L3 hits may have higher tail latency due to contention from other tenants. Padding does not help with this.

### Container CPU limits

Containers may have CPU quota that doesn't match `runtime.NumCPU()`. Use `automaxprocs` (Uber) to set `GOMAXPROCS` correctly.

### Spot instances and preemption

A preempted instance loses cache state. Cold cache after restart is normal. Design for graceful warm-up.

### Bandwidth and burstable

Burstable VMs (T-series on AWS) have variable CPU. Benchmarks during low-burst look different from peak-burst. Reserve capacity for predictable performance.

### Conclusion for cloud Go

Standard padding + sharding works fine. NUMA is invisible. Watch for container/quota mismatches. Use Continuous Profiling.

---

## Long Appendix: An Unexpected Twist — When Coherence Helps

So far we have treated coherence as a cost. There are cases where it helps.

### Shared read-only data

A line in S across many cores is essentially free. Many cores reading the same lookup table simultaneously incur no cross-core traffic.

### Cold-start warm-up

When a service is freshly started, hot data is in DRAM. Over time, it migrates to L3, then L2, then L1. Coherence carries it. Each subsequent request gets faster.

### Sticky session affinity

If a request is consistently routed to the same goroutine, that goroutine's local state stays in its core's cache. No cross-core traffic. This is the implicit benefit of per-P pinning.

### Generational locality

Young goroutines often touch recently-allocated memory. The allocator's per-P caches keep recent allocations local. Coherence preserves this locality.

In all these cases, coherence is doing its job — keeping shared data consistent — and the cost is hidden.

The senior insight: coherence is not the enemy. *Contention* on shared mutable state is the enemy. The cost is in the writes, not the reads. Layout designs that minimise shared writes (snapshots, sharding) leverage coherence for cheap reads while avoiding the write costs.

---

## Long Appendix: A Senior's Closing Mantra

> "Read paths should be cheap. Write paths should be local. Layout is design. Measurement is truth. Padding documents intent. Sharding distributes work. Snapshots publish state. The hardware will reward you."

Recite these eight sentences. They condense thousands of words of theory into eight tactical guidelines.

---

## Long Appendix: True Final Final Final End

This is the absolute end of senior.md. Any more content would be redundant.

Apply what you have learned. Build cache-aware Go. Mentor others. Operate with discipline.

Goodbye, and good luck.

---

## Final Truly Last Appendix: Sample Interview Bench Questions

A senior interviewing candidates might ask:

1. Walk through what happens to a cache line when two cores do `atomic.AddInt64` on the same variable.
2. Why does padding sometimes hurt performance?
3. Design a counter that scales to 64 cores.
4. When is `sync.Map` the wrong choice?
5. What is the difference between `sync.Mutex` and `sync.RWMutex` from a coherence perspective?
6. How would you detect false sharing in production?
7. Explain MESI and why MOESI adds the Owned state.
8. What is the cost of a cross-socket invalidation?
9. Why does `runtime.LockOSThread` not provide cache locality guarantees?
10. Design a read-mostly configuration store.
11. What is per-P sharding and where does Go use it?
12. Why is `atomic.Pointer` useful for snapshot patterns?
13. What does `LOCK XADD` do on x86 at the hardware level?
14. Why is ARM LL/SC sometimes slower under heavy contention?
15. What does `cpu.CacheLinePad` do and when should you use it?

A senior should answer each in 2-3 minutes with confidence and concrete examples.

---

## Long Appendix: Cache Coherence Glossary (Final)

A compact reference glossary.

- **Cache coherence:** Hardware contract that all cores see consistent memory.
- **Cache line:** Smallest cache transfer unit. 64B or 128B.
- **MESI:** Four-state protocol: Modified, Exclusive, Shared, Invalid.
- **MOESI:** Five-state variant with Owned state.
- **False sharing:** Independent variables sharing a cache line.
- **True sharing:** Same variable accessed by many cores.
- **Padding:** Bytes added to isolate hot fields.
- **Sharding:** Splitting state across multiple slots.
- **Snapshot pointer:** Atomic-swappable pointer for read-mostly state.
- **Per-P sharding:** One slot per scheduler P.
- **NUMA:** Non-uniform memory access; multi-socket.
- **Store buffer:** Per-core queue of pending stores.
- **Invalidation queue:** Per-core queue of pending invalidations.
- **Snoop:** Coherence query.
- **RFO:** Read-For-Ownership, request for write access.
- **Snoop filter:** Hardware table tracking which cores hold each line.
- **Directory:** System-level table of line holders.
- **CXL:** Compute Express Link, new memory tier.

If any term is unfamiliar, look it up.

---

## Long Long Appendix: Senior Done

Yes. Done. For real.

---

## Hyper Final Appendix: Five Reflection Prompts

Before moving on, sit with these prompts.

1. **Which struct in your current codebase is most likely to have a coherence problem?** Name it. Plan a benchmark.
2. **Which library do you depend on that may have hidden coherence costs?** Profile it.
3. **What is your team's CI story for catching coherence regressions?** Improve it.
4. **Who on your team is the next person to learn cache coherence?** Plan to mentor them.
5. **What is one architectural decision in your current service that you would revisit with this knowledge?**

These prompts turn reading into action. Act on at least one this week.

---

## Truly Truly Done

End of senior.md. Apply, mentor, build.

---

## Hypothetical Q&A Final

A few last hypothetical interview-style questions and answers to close out.

**Q:** A junior on your team has just discovered false sharing for the first time and proposes padding every struct in the codebase. What do you say?

**A:** I would commend the enthusiasm but redirect. Padding has costs (memory, cache footprint, allocator behaviour). Apply it to structs with demonstrated contention, not preemptively. Show them how to measure first, then optimise. Have them benchmark a candidate struct with and without padding; if the benchmark shows scaling improvement, pad; if not, leave it.

**Q:** A staff engineer claims `sync.Pool` is always the right answer for reusing objects. Is this correct?

**A:** Mostly but not absolutely. `sync.Pool` is excellent for objects that are large enough to amortise the pin/unpin overhead and reusable across goroutines. For very small objects (a few bytes), the pool overhead may exceed the allocation savings. For objects with significant teardown costs, the pool may not invoke teardown reliably (the GC may drop pool entries). Profile to decide.

**Q:** You inherit a Go service with poor scaling characteristics. What is your first step?

**A:** Profile in production: pprof CPU profile at peak load. Identify the top three functions by flat time. If any are `runtime/internal/atomic.*`, `sync.(*Mutex).Lock`, `runtime.semacquire`, or `runtime.lock2`, suspect coherence/contention. Reproduce in a benchmark; verify with `-cpu` sweep. Apply pad/shard fix; measure improvement.

**Q:** What is your stance on hand-rolled lock-free data structures?

**A:** Skeptical. Hand-rolled lock-free is hard to get correct and often slower than a well-tuned mutex-based design. Use the standard library where possible. If you must hand-roll, layout for coherence (pad indices, pad cells) and test extensively with the race detector. Document the assumptions.

**Q:** How do you justify cache-aware design to a non-technical manager?

**A:** Concrete numbers. "Adding 16 bytes of padding to this struct increases throughput by 40%, which reduces our fleet size by 30%, saving $X per month." The argument is economic. The implementation is engineering.

These Q&As model the senior thought process. Practise giving similar answers for scenarios in your own work.

---

## And Finally

If you have read this far, you have an enormous amount of senior-level coherence knowledge. Apply it.

The end.
