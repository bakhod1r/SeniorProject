---
layout: default
title: False Sharing — Senior
parent: False Sharing
grand_parent: Memory Ordering Barriers
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/22-memory-ordering-barriers/05-false-sharing/senior/
---

# False Sharing — Senior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Cache Coherence Protocols in Depth](#cache-coherence-protocols-in-depth)
3. [NUMA and Cross-Socket False Sharing](#numa-and-cross-socket-false-sharing)
4. [Architecting Cache-Aware Subsystems](#architecting-cache-aware-subsystems)
5. [Per-P State and the Go Scheduler](#per-p-state-and-the-go-scheduler)
6. [Lock-Free Data Structures](#lock-free-data-structures)
7. [Hierarchical Sharding](#hierarchical-sharding)
8. [Cross-Language Patterns](#cross-language-patterns)
9. [Measurement at Scale](#measurement-at-scale)
10. [Cost Modelling](#cost-modelling)
11. [Code Examples](#code-examples)
12. [System Design Implications](#system-design-implications)
13. [Edge Cases and War Stories](#edge-cases-and-war-stories)
14. [Mentoring Junior Engineers](#mentoring-junior-engineers)
15. [Self-Assessment](#self-assessment)
16. [Summary](#summary)

---

## Introduction
> Focus: "I design concurrent subsystems. How do I make false-sharing avoidance a structural property of those subsystems, not an afterthought?"

A senior Go engineer designs subsystems where false sharing is impossible by construction. That means:

- The *shape* of the subsystem (sharded, per-P, NUMA-aware) makes contention rare.
- The *layout* of every data structure assumes a 64-byte (or larger) coherence granularity.
- The *interfaces* expose primitives that prevent users from accidentally introducing false sharing through misuse.
- The *tests* and *benchmarks* verify scaling properties under multi-core load.

This file covers the architectural concerns: MESI/MOESI in detail, NUMA, hierarchical sharding, cost models, and design heuristics for high-throughput Go services. The professional file goes deeper into runtime internals; this file is about *system design*.

---

## Cache Coherence Protocols in Depth

### MESI

Intel and many ARM cores use MESI. Each cache line, in each core's L1/L2, has one of four states:

| State | Meaning | Inter-core traffic on write |
|-------|---------|------------------------------|
| **M (Modified)** | Only this core has the line; it differs from RAM. | None (already exclusive). |
| **E (Exclusive)** | Only this core has the line; matches RAM. | None (transitions to M silently). |
| **S (Shared)** | Multiple cores have read-only copies. | Yes: must invalidate other shareds. |
| **I (Invalid)** | This core does not have a valid copy. | Yes: must fetch from owner. |

The state diagram for *one core's view of one line*:

```
            +---read others have---+
            |                       |
            v                       |
[I] --read no others have--> [E] --write--> [M]
 ^                                            |
 |                                            v
 +------------- other writes ------------- bus traffic
```

False sharing keeps two cores oscillating between M and I states for the same line, with bus traffic on every transition.

### MOESI (AMD)

AMD adds an **O (Owner)** state. A line in O can be modified *and* be shared with other cores (which hold S copies). Reads from S cores go directly to O without writeback to memory. This optimises write-then-read patterns where one core writes and many cores read.

For false sharing, MOESI still serialises writes between cores — the O→M transition on another core forces invalidation. The cost is comparable to MESI in pure write-write contention scenarios.

### MESIF (Intel Xeon)

Intel adds an **F (Forward)** state. One of the shared copies is the "forwarder" — when a new requester arrives, the forwarder responds directly instead of triggering all sharers to respond. This reduces the snoop response burden for many-reader scenarios but again does not change write-write contention.

### Directory-based coherence

Large many-socket systems do not use snooping (which broadcasts on every coherence event). They use *directory-based* coherence: a central or distributed directory tracks which cores have copies of each line. Coherence events look up the directory and send targeted messages.

Directory protocols have higher per-event latency (extra hop through the directory) but better scaling for large numbers of cores. False sharing on a directory-based system is still a problem; the cost per bounce is higher, the cost per non-bounce access is also slightly higher.

### Implications for Go programmers

You do not write MESI directly, but you should know:

- Any `atomic.AddInt64` or any `atomic.Store` writes through `lock`-prefixed (x86) or `LDAR/STLR` (ARM) instructions, requiring the line in M state.
- Multiple cores writing the same line (true or false sharing) serialise at the protocol level.
- The cost per bounce is roughly 30-80 ns on a single socket, 100-300 ns across sockets.
- Reads after a write incur a "warm-up" miss (data must be loaded into the reader's cache).
- The protocol does not know about your variables; only your lines.

A senior engineer designs around these costs.

---

## NUMA and Cross-Socket False Sharing

Most modern servers have two, four, or more sockets, each with its own memory controller. Memory attached to socket 0 is "local" to socket 0's cores and "remote" to socket 1's cores. Remote access is 1.5-3x more expensive than local.

Coherence between sockets is more expensive than within: the inter-socket interconnect (Intel QPI/UPI, AMD Infinity Fabric) has higher latency than the on-chip ring/mesh.

### NUMA-aware sharding

For NUMA, you want:

1. **Each socket's hot data lives in that socket's memory.** Otherwise every access pays the remote tax.
2. **Cores on the same socket can share hot data more cheaply than cores across sockets.** Group shards by socket where possible.

Go does not expose socket affinity through standard APIs. Possible approaches:

- Run multiple Go processes, one per socket, with explicit affinity via `taskset` or `numactl`.
- Use libraries that wrap `numa(3)` (Linux) and `set_mempolicy(2)` to allocate per-socket memory.
- Accept that the Go runtime is not NUMA-aware and design at the level "one process per socket."

A practical pattern for large servers: run N Go processes, each with `GOMAXPROCS = cores-per-socket`, each pinned to one socket. Inter-process communication via shared memory or sockets. Each process is *internally* uniform-memory and uses cache-line padding as usual.

### Cross-socket false sharing

If, despite your best efforts, a cache line ends up bouncing across sockets, the cost is dramatic. A cross-socket bounce can be 300 ns vs 30 ns intra-socket. A hot variable doing one update per nanosecond on intra-socket scales by ~30; the same on cross-socket scales by ~3-5 if at all.

The fix is the same in principle (pad, shard) but executed at the system level (one process per socket, hard CPU affinity).

### `perf c2c` for NUMA

`perf c2c` separates HITM (modified-line hits within socket) from RMTM (remote modified-line hits across sockets). RMTM events are red flags: they indicate cross-socket bouncing. The reports show counts per source line; a high RMTM count on a counter or queue index is your smoking gun.

---

## Architecting Cache-Aware Subsystems

### Pattern 1: per-P sharded subsystem

Pin work to the *current P* (Go processor) via `runtime_procPin`. Each P has its own shard. As long as the goroutine does not yield, all writes stay on the same P, and the per-P cache stays exclusive to that P's core.

```go
package perp

import (
    _ "unsafe"
)

//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type Subsystem struct {
    shards []shard
}

type shard struct {
    counter int64
    _       [56]byte
}

func (s *Subsystem) Inc() {
    p := runtime_procPin()
    s.shards[p].counter++ // no atomic needed: P pinned, only one writer
    runtime_procUnpin()
}
```

Without `runtime_procPin`, you need atomics on the write because the goroutine could be preempted, rescheduled to another P, and another goroutine could land on this shard. With `procPin`, the access is single-threaded relative to this P — but for the duration of the pin, the goroutine cannot be preempted, which can disrupt scheduling. Use sparingly and for very short pin windows.

This is a common technique in production high-performance Go code (cockroachdb, dgraph, vitess).

### Pattern 2: writer-local + read-only-published

The writer maintains a local copy of data and periodically publishes a snapshot to a read-only structure. Readers see consistent snapshots; writers face no contention.

```go
type Stats struct {
    writerLocal map[string]int64

    published atomic.Pointer[map[string]int64]
}

func (s *Stats) Inc(key string) {
    s.writerLocal[key]++ // single goroutine
}

func (s *Stats) Publish() {
    snapshot := make(map[string]int64, len(s.writerLocal))
    for k, v := range s.writerLocal {
        snapshot[k] = v
    }
    s.published.Store(&snapshot)
}

func (s *Stats) Read(key string) int64 {
    m := s.published.Load()
    if m == nil {
        return 0
    }
    return (*m)[key]
}
```

Single writer = no contention. Readers see lagging but consistent data. The published pointer is in shared state in readers' caches.

### Pattern 3: epoch-based reclamation

Lock-free data structures often need delayed memory reclamation (a node may be in use by a reader after the writer has "freed" it). Epoch-based reclamation lets each thread declare its current epoch; memory is reclaimed once all threads pass that epoch.

Each thread's epoch counter is per-thread, padded to a cache line. Writers read all threads' epochs occasionally; reads are cheap (atomic loads). Writes to your own epoch are uncontended.

### Pattern 4: hierarchical aggregation

For very high cardinality (thousands of shards), aggregating all shards on every read is expensive. Use a two-level hierarchy:

- Level 0: per-core shards.
- Level 1: per-socket aggregates, updated periodically by a "shepherd" goroutine.
- Top: a global aggregate, updated even less frequently.

Reads serve from the global aggregate (~lag-bounded). Writes hit the per-core shard. The shepherd consolidates upward.

This is how high-end metrics systems achieve linear write scaling with bounded read cost.

### Pattern 5: writer-side decay

For statistics counters, exact precision is often not required. A per-core counter can be flushed and zeroed periodically, instead of monotonically increasing. This bounds the data range and keeps the working set small.

### Pattern 6: pad-then-batch

Instead of one increment per event, batch many increments and flush a sum periodically:

```go
type Batched struct {
    local int64
    pub   atomic.Int64
    _     [40]byte
}

func (b *Batched) Inc()   { b.local++ }
func (b *Batched) Flush() { b.pub.Add(b.local); b.local = 0 }
```

If `Flush` runs every 1000 events, you do ~999 cheap local increments and 1 atomic per 1000 events. Cache-line contention drops by 1000x for the same logical throughput.

The catch: readers see lag (up to one flush interval). For exact-precision counters this is unacceptable; for telemetry it is fine.

---

## Per-P State and the Go Scheduler

The Go scheduler maintains per-P state for runqueues, mcache, ggcaches, and more. Reading `runtime/runtime2.go` (the `p` struct) is enlightening.

### The `p` struct (paraphrased)

```go
type p struct {
    id      int32
    status  uint32 // _Prunning, _Psyscall, etc.
    link    puintptr
    schedtick   uint32
    syscalltick uint32
    sysmontick  sysmontick
    m           muintptr // back-link to associated m

    mcache      *mcache
    pcache      pageCache
    raceprocctx uintptr

    deferpool    []*_defer
    deferpoolbuf [32]*_defer

    goidcache    uint64
    goidcacheend uint64

    // Per-P run queue
    runqhead uint32
    runqtail uint32
    runq     [256]guintptr
    runnext  guintptr

    // GC
    gFree struct {
        gList
        n int32
    }

    sudogcache []*sudog
    sudogbuf   [128]*sudog

    mspancache struct {
        len int
        buf [128]*mspan
    }

    pcache_pcache_runtime pcache_unused

    // ... timers and more ...
}
```

Notice:

- `runqhead` and `runqtail` are adjacent (offsets in same line). For very-high-frequency scheduler operations, this could false-share. The Go runtime has periodically introduced and removed explicit padding here as the cost/benefit changed across CPU generations.
- The `runq` array of 256 pointers is its own large structure (256 × 8 = 2048 bytes), so it spans many cache lines. Writes to `runq[i]` don't false-share with writes to `runq[j]` because they're 8 bytes apart but `i` differs each time.
- `mcache` is a pointer to a separate allocation that is itself cache-line-padded internally.

The runtime's overall pattern is: `p` is large enough that internal field adjacency is not the dominant cost; the *cross-P* contention is on shared global structures (e.g., `sched.gFree` for free-G lists), which are protected by mutexes and have their own padded layouts.

### `sysmon` and global structures

A single "sysmon" goroutine runs without an M, periodically checking system state. It accesses several global fields (timers, GC trigger). These globals are not per-P; their access is rare enough that false sharing on them is not a concern.

### `sema` (semaphore) treap nodes

`runtime/sema.go` uses a treap (tree-heap hybrid) for waiter lists. Each treap node is padded:

```go
type semaRoot struct {
    lock  mutex
    treap *sudog
    nwait uint32
}

// (semtable maintains 251 semaRoots, indexed by hash of address)
const semTabSize = 251
var semtable semTable

type semTable [semTabSize]struct {
    root semaRoot
    pad  [cpu.CacheLinePadSize - unsafe.Sizeof(semaRoot{})]byte
}
```

(Paraphrased — the exact layout varies by Go version.) The padding ensures that two semaphores hashing to adjacent slots do not false-share their root pointers / lock state.

### `mcache` and per-P allocation

`runtime/mcache.go` defines per-P caches of small spans. Each `mcache` is allocated as its own object, naturally separate. Internally, the mcache has per-size-class state; in some versions, hot fields within the mcache are explicitly padded.

The takeaway: every per-P structure in the runtime is internally aware of cache layout. This is not optional for high-performance code.

---

## Lock-Free Data Structures

Lock-free queues, stacks, and hash maps are the canonical false-sharing-aware data structures. Standard design rules:

### Rule 1: separate producer and consumer state

A queue with producer-side state (head, count) and consumer-side state (tail, count) must place these on separate cache lines. Otherwise every producer write bounces the consumer's line and vice versa.

### Rule 2: place the data slots between the indices

In an SPSC ring, the buffer of data slots is between head and tail conceptually. Physically, put the buffer first and the indices after — or both before/after — but make sure the indices are not on the same line as a frequently-accessed slot.

### Rule 3: pad each "section" of mutable state

For an MPMC queue with sectional state (one section per group of slots), pad each section. Otherwise consumers walking the buffer can stall on producer writes to adjacent slots.

### Rule 4: avoid cross-CPU CAS where possible

A compare-and-swap on a shared variable is the most expensive coherence event (it requires the line in M state). Designs that minimise cross-CPU CASes scale best. Per-CPU queues with a "stealer" path are a common pattern: each CPU's queue is local; stealing from another CPU is rare but possible.

### Rule 5: write fewer fields

Each field written is a coherence event. A design that does one CAS instead of three has 1/3 the coherence cost. Compress state into a single 64-bit value where possible (e.g., pack head and tail into one `atomic.Uint64`).

### A real-world lock-free queue layout

```go
type LockFreeQueue struct {
    // Frequently written by producer:
    enqState struct {
        head    atomic.Uint64
        _       [56]byte
    }

    // Frequently written by consumer:
    deqState struct {
        tail    atomic.Uint64
        _       [56]byte
    }

    // Read-mostly metadata (capacity, mask):
    mask uint64
    cap  uint64
    _    [48]byte

    // Buffer (cache-line aligned per slot, possibly padded if slots are
    // small and frequently contended):
    buf []slot
}

type slot struct {
    seq atomic.Uint64
    val interface{}
}
```

Each `slot` is roughly 24 bytes; on a 64-byte line, 2-3 slots fit. If producers and consumers are walking the buffer in lockstep, they touch slots within a few of each other — false sharing between slots can occur. Mitigation: pad each slot to 64 bytes:

```go
type paddedSlot struct {
    seq atomic.Uint64
    val interface{}
    _   [40]byte
}
```

Memory cost: 64 bytes per slot instead of ~24. For a 1M-entry queue, that's 64 MB vs 24 MB. Often worth it for hot queues.

---

## Hierarchical Sharding

For very high-throughput systems (millions of ops/sec/core, many cores), a flat sharded counter is still bottlenecked by:

- Aggregation cost (reading all shards on each query).
- Memory for shards.

Hierarchical sharding solves both:

```
Top level:    global atomic counter, read every N ms
                            ^
                            |  refresh
                            |
Mid level:   per-NUMA-node aggregates (4-8 of them)
                ^             ^
                |             |
                |  refresh    |
                |             |
Bottom level:  per-core shards (32-64 of them)
                ^   ^   ^   ^
                |   |   |   |
              writes (1 ns each, no contention)
```

Each level absorbs writes at a different rate. The bottom is hot and uncontended (per-core); the middle aggregates periodically; the top serves reads with at most one level of lag.

Implementation sketch:

```go
type HierarchicalCounter struct {
    perCore []paddedInt64 // bottom level
    perNuma []paddedInt64 // mid level (e.g. 4 NUMA nodes)
    global  atomic.Int64  // top level
}

// Writes hit per-core.
func (h *HierarchicalCounter) Inc(coreID int) {
    h.perCore[coreID].v.Add(1)
}

// A background goroutine periodically flushes upward.
func (h *HierarchicalCounter) flusher() {
    for {
        time.Sleep(time.Millisecond * 10)
        for i := range h.perCore {
            v := h.perCore[i].v.Swap(0)
            numa := i / coresPerNuma
            h.perNuma[numa].v.Add(v)
        }
        var total int64
        for i := range h.perNuma {
            total += h.perNuma[i].v.Swap(0)
        }
        h.global.Add(total)
    }
}

func (h *HierarchicalCounter) Value() int64 {
    return h.global.Load() // bounded staleness of ~10ms
}
```

Properties:

- Write cost: one increment of a per-core atomic. ~1 ns / op uncontended.
- Read cost: one atomic load. ~1 ns / op.
- Staleness: up to one flush interval.
- Total memory: 64 bytes × (perCore + perNuma) ≈ a few KB.
- Aggregation cost: O(cores), but amortised across flush intervals.

This pattern scales linearly with cores up to thousands of cores. It is the architecture of choice for top-tier observability systems.

---

## Cross-Language Patterns

False sharing affects every language with shared-memory concurrency. The fixes differ in syntax:

- **C/C++**: `alignas(64)`, manual `char pad[56]`, `__cacheline_aligned` macros. Compiler-supported.
- **Java**: `@Contended` annotation (JEP 142, since Java 8). The JVM adds padding automatically. Disabled by default; enable with `-XX:-RestrictContended`.
- **Rust**: `#[repr(align(64))]` on structs. Compiler-supported. The `crossbeam-utils` crate provides `CachePadded`.
- **C#**: no language support; manual padding fields.
- **Go**: no language support; manual padding fields with `[N]byte`.

The cross-language lesson: false sharing is universal. The fixes are universal in concept (pad to cache line) but vary in ergonomics. Go's lack of native support is a minor papercut but does not prevent correct code.

Reading the LMAX Disruptor source (in Java) is a great cross-language exercise. The Disruptor's index management uses heavy `@Contended` (or manual padding pre-Java 8) and is the canonical example of how to design for false-sharing-free throughput.

---

## Measurement at Scale

For production systems, you cannot run `perf c2c` continuously. Production measurement strategies:

### Strategy 1: continuous hardware-counter sampling

Use `perf record -e cache-misses,L1-dcache-load-misses` running at low sample rate (e.g., 1% of cycles). Aggregate over hours to see whether the miss rate trends with traffic.

A sudden rise in `cache-misses` correlated with traffic spikes suggests a hot variable becoming contended (true or false sharing).

### Strategy 2: synthetic benchmarks in CI

Run scaling benchmarks in CI on every PR. A regression that breaks linear scaling will show up.

### Strategy 3: load-test in staging with `perf c2c`

Before promoting a release, run `perf c2c` against a staging load test. The report identifies any new false-sharing hot spots introduced by the release.

### Strategy 4: in-process metrics

Some tools (e.g., `pprof` with hardware counters) can be embedded in production binaries. Sampling at very low rate gives you flight-recorder-style data on cache behaviour without significant overhead.

### Strategy 5: synthetic load via "cache-line stress" tests

Periodically run a stress test that hammers known hot paths. Compare throughput against historical baselines. Regressions trigger investigation.

---

## Cost Modelling

To reason about false sharing, build a back-of-envelope cost model:

```
T_op = T_uncontended + P_bounce * T_bounce

where:
  T_uncontended = ~5 ns (uncontended atomic on L1-resident line)
  T_bounce      = ~30 ns intra-socket, ~150 ns cross-socket
  P_bounce      = probability that this op encounters a bounce
```

For two cores hammering one line at full rate, `P_bounce ≈ 1` and `T_op ≈ 35 ns`.

For N cores hammering one line, `P_bounce ≈ 1 - 1/N` (most ops see a bounce) and the line becomes a serialisation bottleneck.

After padding, `P_bounce ≈ 0` and `T_op ≈ 5 ns` for each core in parallel.

The cost model helps when designing: if the operation is bottlenecked by something else (e.g., 50 ns of business logic), the false-sharing 25 ns is no longer the bottleneck. Spending memory to pad an already-non-bottleneck variable is waste.

### Worked example: a metrics-heavy parser

A parser processes 1 GB of input, 1 byte per cycle, 1 ns per byte. Per-byte work calls `metric.Inc()` (an atomic op).

- Without contention: 1 ns/byte for parsing + 5 ns/byte for atomic = 6 ns/byte, 167 MB/sec/core.
- With 8 cores false-sharing the metric counter: 1 + 5 + 7*30 = 216 ns/byte, 5 MB/sec total (worse than one core).
- With 8 padded shards: 1 + 5 = 6 ns/byte * 8 cores = 1.3 GB/sec.

The padding goes from "blocks parser at 5 MB/sec" to "parser at 1.3 GB/sec" — a 260x speedup. Worth 8x memory for the metric structure.

---

## Code Examples

### Example 1: NUMA-aware sharded counter (Linux)

```go
//go:build linux

package numacounter

import (
    "runtime"
    "sync/atomic"
    "syscall"
    "unsafe"
)

// Querying NUMA node from current CPU via getcpu(2).

func currentNumaNode() int {
    var cpu, node uint32
    syscall.RawSyscall(syscall.SYS_GETCPU,
        uintptr(unsafe.Pointer(&cpu)),
        uintptr(unsafe.Pointer(&node)),
        0)
    return int(node)
}

type Counter struct {
    perNode [][]paddedInt64
}

type paddedInt64 struct {
    v atomic.Int64
    _ [56]byte
}

func New(nodes int, coresPerNode int) *Counter {
    c := &Counter{perNode: make([][]paddedInt64, nodes)}
    for i := range c.perNode {
        c.perNode[i] = make([]paddedInt64, coresPerNode)
    }
    return c
}

func (c *Counter) Inc() {
    node := currentNumaNode()
    cpu := getCPU()
    c.perNode[node][cpu%len(c.perNode[node])].v.Add(1)
}

func (c *Counter) Total() int64 {
    var total int64
    for _, nodeShards := range c.perNode {
        for i := range nodeShards {
            total += nodeShards[i].v.Load()
        }
    }
    return total
}

func getCPU() int { return runtime.NumCPU() } // placeholder
```

In practice, querying NUMA node per call is slow (~50 ns for the syscall). Caching it via `runtime_procPin` and a per-P node lookup is faster.

### Example 2: padded MPMC queue (basic)

```go
package mpmc

import (
    "runtime"
    "sync/atomic"
)

type Queue struct {
    head   atomic.Uint64
    _      [56]byte
    tail   atomic.Uint64
    _      [56]byte
    mask   uint64
    buf    []slot
}

type slot struct {
    seq atomic.Uint64
    val interface{}
    _   [40]byte
}

func NewQueue(size int) *Queue {
    if size&(size-1) != 0 {
        panic("size must be power of two")
    }
    q := &Queue{
        mask: uint64(size - 1),
        buf:  make([]slot, size),
    }
    for i := range q.buf {
        q.buf[i].seq.Store(uint64(i))
    }
    return q
}

func (q *Queue) Enqueue(v interface{}) bool {
    pos := q.head.Load()
    for {
        s := &q.buf[pos&q.mask]
        seq := s.seq.Load()
        diff := int64(seq) - int64(pos)
        if diff == 0 {
            if q.head.CompareAndSwap(pos, pos+1) {
                s.val = v
                s.seq.Store(pos + 1)
                return true
            }
        } else if diff < 0 {
            return false // queue full
        } else {
            pos = q.head.Load()
        }
        runtime.Gosched()
    }
}

func (q *Queue) Dequeue() (interface{}, bool) {
    pos := q.tail.Load()
    for {
        s := &q.buf[pos&q.mask]
        seq := s.seq.Load()
        diff := int64(seq) - int64(pos+1)
        if diff == 0 {
            if q.tail.CompareAndSwap(pos, pos+1) {
                v := s.val
                s.val = nil
                s.seq.Store(pos + uint64(len(q.buf)))
                return v, true
            }
        } else if diff < 0 {
            return nil, false // queue empty
        } else {
            pos = q.tail.Load()
        }
        runtime.Gosched()
    }
}
```

This is essentially the Dmitry Vyukov MPMC queue, translated to Go. Each slot is padded so that producer and consumer walking the buffer do not false-share.

### Example 3: cache-line-aware hash table

```go
package shardedmap

import (
    "runtime"
    "sync"
)

type Shard struct {
    sync.RWMutex
    data map[string]interface{}
    _    [32]byte // approx pad to 64 (RWMutex ~24 bytes, map header 8)
}

type Map struct {
    shards []Shard
}

func New() *Map {
    n := runtime.GOMAXPROCS(0) * 4 // 4x oversharding for good distribution
    m := &Map{shards: make([]Shard, n)}
    for i := range m.shards {
        m.shards[i].data = make(map[string]interface{})
    }
    return m
}

func (m *Map) shardIdx(key string) int {
    var h uint32 = 2166136261
    for i := 0; i < len(key); i++ {
        h ^= uint32(key[i])
        h *= 16777619
    }
    return int(h) % len(m.shards)
}

func (m *Map) Get(key string) (interface{}, bool) {
    s := &m.shards[m.shardIdx(key)]
    s.RLock()
    v, ok := s.data[key]
    s.RUnlock()
    return v, ok
}

func (m *Map) Set(key string, v interface{}) {
    s := &m.shards[m.shardIdx(key)]
    s.Lock()
    s.data[key] = v
    s.Unlock()
}
```

A simple sharded map. Adjacent shards do not false-share due to padding. The 4x oversharding reduces lock contention per shard.

The `_ [32]byte` is approximate; you should verify with `unsafe.Sizeof` that the struct is one cache line (or a multiple).

### Example 4: per-P state via `procPin`

```go
package perp

import (
    _ "unsafe"
)

//go:linkname runtime_procPin runtime.procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin runtime.procUnpin
func runtime_procUnpin()

type Stats struct {
    shards []shard
}

type shard struct {
    n int64
    _ [56]byte
}

func New(numP int) *Stats {
    return &Stats{shards: make([]shard, numP)}
}

func (s *Stats) Inc() {
    p := runtime_procPin()
    s.shards[p].n++ // no atomic — pinned to P
    runtime_procUnpin()
}

func (s *Stats) Sum() int64 {
    // Cannot read shards while a writer is mid-increment without atomic.
    // For exact reads, use atomics; for sampled reads, accept tearing.
    var total int64
    for i := range s.shards {
        total += s.shards[i].n
    }
    return total
}
```

`runtime_procPin` is in an internal-ish package (`runtime`) but accessible via `go:linkname`. Production code that uses it must be aware of the risks: pin disables preemption, so a long-running pinned section can disrupt scheduling. Use only for very short (sub-microsecond) sections.

### Example 5: padded sync.Pool wrapper

```go
package pool

import (
    "sync"
)

type Padded[T any] struct {
    pool sync.Pool
}

func New[T any](newFunc func() T) *Padded[T] {
    return &Padded[T]{
        pool: sync.Pool{
            New: func() interface{} { return newFunc() },
        },
    }
}

func (p *Padded[T]) Get() T {
    v := p.pool.Get()
    if v == nil {
        var zero T
        return zero
    }
    return v.(T)
}

func (p *Padded[T]) Put(v T) {
    p.pool.Put(v)
}
```

`sync.Pool` itself is internally padded — no need to add user-side padding for cache-line concerns. The wrapper above is just for generics and ergonomics.

---

## System Design Implications

False-sharing-awareness shapes system designs at higher levels:

### Design implication 1: prefer many small structs over few large structs

A single large struct accessed by many goroutines becomes a contention hotspot, both for true sharing and for false sharing of internal fields. Split into per-shard structs.

### Design implication 2: prefer arrays over linked lists

Linked lists have one allocation per node, scattered across memory. Iterating means cache miss per node. Arrays are contiguous and cache-friendly. For concurrent writers, arrays of padded structs are the better data layout.

### Design implication 3: prefer immutable shared state

Read-mostly data (config, lookup tables) should be allocated once and shared via pointer. Readers' caches hold copies in shared state forever; no coherence traffic. Mutations create a new immutable copy and swap atomically.

### Design implication 4: prefer batching over per-event work

Batch work into chunks. Each batch involves one atomic increment of a counter, not N. This amortises the cache-line cost over N events.

### Design implication 5: per-CPU caches even for non-counter state

Per-CPU caches of all kinds: free lists, slab allocators, sample buffers, ring buffers. Each CPU has its own working set; cross-CPU work is rare. This is the dominant scaling pattern for high-performance systems.

### Design implication 6: avoid "synchronizing on a single bool"

```go
var flag atomic.Bool
go func() { for !flag.Load() { ... } }()
go func() { flag.Store(true) }()
```

Every check on `flag` brings the line into shared state in the reader. The writer's store invalidates it. If many goroutines are checking and one is writing, this is a coherence storm. Use channels (the runtime's signalling primitive) or `sync.Cond`.

### Design implication 7: prefer "post-the-result" to "pull the result"

When one goroutine has data others need, *push* it (via channel send or atomic publish) rather than letting others poll. Polling = many readers checking one line; pushing = one writer fanning out.

### Design implication 8: pre-allocate per-shard structures

Lazy allocation of per-shard structures introduces contention on the allocation path. Pre-allocate at startup; pay the cost once.

---

## Edge Cases and War Stories

### War story 1: the slow-growth shards

A counter library used a `sync.Map` to map keys to per-key shards. Hot keys allocated shards on first use. The first inflight burst of traffic hit shards that had never been allocated; the allocation path was contended via `sync.Map.LoadOrStore`. Throughput tanked for the first second of load.

Fix: pre-allocate shards for known keys at startup. Use a per-key sharded counter (one shard per known key) instead of dynamic allocation.

### War story 2: the GC-triggered false sharing

A high-throughput server allocated padded structs in a tight loop. The GC's mark phase touched each struct's metadata, briefly bouncing the cache line. Throughput dropped by 30% during each GC cycle.

Fix: pool the padded structs in a `sync.Pool` (which holds them through GC cycles in many cases) and reuse.

### War story 3: the false-positive `perf c2c`

`perf c2c` showed high HITM on a struct's first field. Investigation revealed: the struct started on a non-aligned offset, and the first field shared a line with the *previous* struct's last field. The "false sharing" was real but at the inter-struct boundary, not between fields within the struct.

Fix: ensure the struct's natural alignment yields cache-line alignment of the first element when allocated.

### War story 4: the runtime regression

A Go runtime upgrade subtly changed the layout of a per-P struct, removing a previously-padding field. Production p99 latency increased by 15%. Diagnosis: the run-queue head and tail were now on the same line.

The fix was in the Go runtime itself (re-added the padding in a subsequent point release). The lesson: large-scale users benchmark every runtime upgrade for performance regressions.

### War story 5: the "alignment lottery"

A library shipped a padded struct that worked perfectly in dev. In production, on a specific cloud provider's instance type, performance was 3x worse. The instance had different cache behaviour (smaller L1, larger L3) that exposed a layout sensitivity.

Fix: re-tune padding for the production instance type. Measure on the target platform, not just on dev.

### War story 6: the data-flow false sharing

A pipeline of goroutines passed messages through channels. Each message was a small struct. The send and receive sides accessed adjacent fields of the same struct, causing cache-line bouncing on every message.

Fix: pad the message structs.

### War story 7: the allocation aliasing

Two `Counter` instances allocated by `new(Counter)` in close succession were placed adjacent in the same span by the allocator. Their hot fields shared a cache line. The bug only manifested with two specific instances under load.

Fix: each `Counter` was sized to one or more cache lines (via explicit padding within), so allocations are at least one cache line apart.

### War story 8: the test that always passed

A `TestCounterScales` test passed reliably in CI. On production hardware, the underlying false sharing tanked throughput. The CI runner had 2 cores (HT siblings of one physical core); cross-core traffic was free. Production had 16 physical cores.

Fix: CI runs at multiple `-cpu` levels including a high level matching production. Better: dedicated perf-test pipeline on production-equivalent hardware.

---

## Mentoring Junior Engineers

As a senior, part of your job is teaching the next level. False sharing is a great teaching topic because:

1. It is observable. Junior engineers can run a benchmark and see the 20x speedup.
2. It is universal. Every concurrent language has it.
3. It connects software and hardware. It is a gateway to thinking about cache, coherence, NUMA.
4. It has a clear, mechanical fix. Once you see it, you can fix it.

A teaching sequence:

1. Have them run the [Adjacent vs Padded benchmark](#code-examples). Watch the numbers move.
2. Show them the `unsafe.Sizeof` and `unsafe.Offsetof` print to verify layout.
3. Have them read `sync.Pool`'s padding in the Go runtime.
4. Walk through `perf c2c` output on a stress test.
5. Review their next code change for cache-layout awareness.

After a few weeks of this, they will spot false sharing in code reviews, design APIs that avoid it, and explain the tradeoffs to their juniors.

### Common teaching mistakes

- Showing the bug without showing the *why*. Engineers need the hardware model to predict and prevent, not just to fix.
- Cargo-culting padding. Make clear that padding without measurement is harmful (memory waste, cache pressure).
- Not connecting to runtime patterns. `sync.Pool`'s padding is the connection from "obscure perf trick" to "this is how the Go runtime does it."

---

## Self-Assessment

- [ ] I can explain MESI in terms of state transitions and inter-core messages.
- [ ] I can design a NUMA-aware sharded counter for a multi-socket server.
- [ ] I can architect a hierarchical sharding system with bounded read lag.
- [ ] I can recognise false sharing in `perf c2c` output and distinguish it from true sharing.
- [ ] I can read the Go runtime's `sync.Pool`, scheduler, and semaphore implementations and explain the padding choices.
- [ ] I can build a cost model for cache-line bouncing in a specific workload.
- [ ] I can identify when to use `runtime_procPin` for per-P sharded structures.
- [ ] I can mentor a junior engineer through diagnosing and fixing a false-sharing bug.
- [ ] I know war stories of false sharing in production and what mitigated them.
- [ ] I can review a system design and predict false-sharing hotspots before code is written.

---

## Summary

At the senior level, false sharing is a *design property*. You architect concurrent subsystems so that false sharing is impossible by construction, not an afterthought to fix later. The toolkit includes:

- Cache-line padding, sized to platform-specific constants.
- Sharding (per-CPU, per-NUMA, hierarchical).
- Lock-free designs with separated producer/consumer state.
- Per-P pinning via `runtime_procPin` for very hot paths.
- Read-only-published patterns where readers see immutable snapshots.
- Cost models that connect cache-line bouncing to overall system throughput.

You read the Go runtime to learn the conventions (`sync.Pool`, semaphores, scheduler all pad). You measure with `perf c2c` and hardware counters. You write benchmarks that exercise concurrency at production scale. You mentor juniors to spot and prevent.

The professional file continues this thread into deep runtime internals, perf-tool mastery, microarchitectural quirks, and the rare cases where false sharing avoidance requires going beneath the Go runtime to the OS or the silicon.

---

## Appendix A: MESI and MOESI in Depth

A senior engineer must be able to reason about cache coherence at the protocol level. The state machine has only a handful of transitions, but each one has implications for performance and correctness.

### MESI states

| State | Meaning | Permission |
|-------|---------|------------|
| Modified (M) | Line is dirty in this cache; no other cache has it. | Read + write, no coordination needed. |
| Exclusive (E) | Line is clean in this cache; no other cache has it. | Read freely; write transitions to M without coordination. |
| Shared (S) | Line is clean in this cache; *may* exist in others. | Read freely; write requires broadcast (Invalidate to other Ss). |
| Invalid (I) | Line is not present in this cache. | Must fetch before any access. |

### Transitions (Intel-style)

```
       Local Read           Local Write          Remote Read         Remote Write
I  ->  E or S (load)        M (write+install)    -                   -
S  ->  S (hit)              M (after Invalidate) S (no change)       I (we invalidate)
E  ->  E (hit)              M (silent)           S (we downgrade)    I
M  ->  M (hit)              M (hit)              S (we writeback)    I (writeback+inv)
```

The expensive transitions:
- `S -> M` requires broadcasting Invalidate and waiting for ACKs. Latency: ~50-200 cycles.
- `M -> I` (remote write to our M line) requires writeback to memory or direct cache-to-cache transfer. Latency: ~100-300 cycles.

A false-sharing scenario:

1. Core 0 writes its counter at offset 0. Line is in M on core 0.
2. Core 1 writes its counter at offset 8. Core 1 must invalidate core 0's line (`M -> I` on core 0, line transfers to core 1 as M).
3. Core 0 writes again at offset 0. Same dance in reverse.
4. Repeat: the line ping-pongs every write.

Each ping-pong is ~100-300 cycles of stalled execution on at least one core. At 1ns/cycle (3 GHz), that is 30-100ns of wasted latency per atomic op that should take 5ns.

### MOESI (AMD)

AMD's MOESI adds the **Owner (O)** state: a line in O is dirty, but other caches may also have it in S. The owner is responsible for writeback when evicted.

| State | Dirty? | Exclusive? | Notes |
|-------|--------|------------|-------|
| M | Yes | Yes | Same as MESI M. |
| O | Yes | No | Owner of a dirty line; others have S. |
| E | No | Yes | Same as MESI E. |
| S | No | No | Same as MESI S. |
| I | - | - | Same as MESI I. |

Why MOESI helps false sharing: in MESI, when core 1 reads a line that core 0 holds in M, core 0 must write back to memory and downgrade to S. The line round-trips through DRAM. In MOESI, core 0 transitions M -> O and forwards directly to core 1's S, no memory write. This saves the DRAM round-trip.

Implication: AMD CPUs typically show *somewhat lower* false-sharing penalty than Intel CPUs for read-after-write patterns. But for write-after-write (true ping-pong), both architectures pay the same Invalidate cost. Padding helps both equally.

### MESIF (Intel Server)

Intel server CPUs (Xeon) use MESIF, adding the **Forward (F)** state. The F state is a single-source-of-truth designation: when multiple caches hold a line in S, exactly one holds it in F. Remote reads can ask "who has F?" and the F-holder forwards directly without each S-holder having to respond.

For false sharing, MESIF reduces the *broadcast cost* of reads on shared lines but does not eliminate the Invalidate cost of writes. False sharing still bounces.

### Directory-based vs snoop-based

On large NUMA systems (4+ sockets), broadcasting Invalidate to every core is infeasible. Such systems use a *directory*: each line has a home node that tracks which caches hold copies. Invalidates go through the directory.

Directory traffic adds latency to coherence ops (a directory lookup costs cycles). On a single-socket system, snoop coherence dominates and the cost is the inter-core mesh. On multi-socket, directory + interconnect (UPI/CXL/Infinity Fabric) dominates and the cost can be 10x higher.

Senior implication: on multi-socket servers, false sharing across sockets is 5-10x more expensive than on a single socket. Cross-socket sharded designs are essential.

---

## Appendix B: NUMA Topology Discovery and Pinning

To reason about cross-socket false sharing, you need to know your machine's topology.

### `lscpu`

```
$ lscpu
Architecture:          x86_64
CPU(s):                64
Thread(s) per core:    2
Core(s) per socket:    16
Socket(s):             2
NUMA node(s):          2
NUMA node0 CPU(s):     0-15,32-47
NUMA node1 CPU(s):     16-31,48-63
L1d cache:             32K
L2 cache:              1024K
L3 cache:              22528K
```

Read: 2 sockets, 16 cores each (32 threads with SMT). NUMA node 0 owns cores 0-15 and their hyperthread siblings 32-47. Each socket has its own L3 cache (22.5 MB). A cache line in node 0's L3 cannot be reached from node 1 except via the inter-socket interconnect.

### `numactl --hardware`

```
$ numactl --hardware
available: 2 nodes (0-1)
node 0 cpus: 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47
node 0 size: 64000 MB
node 0 free: 28000 MB
node 1 cpus: 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63
node 1 size: 64000 MB
node 1 free: 30000 MB
node distances:
node   0   1
  0:  10  21
  1:  21  10
```

Read: 64 GB DRAM per node. Local access cost = 10 (normalised); remote = 21. Cross-socket memory access is ~2x the latency of local-socket access. False sharing of a line whose home is node 0, but bouncing between node 0 and node 1, pays this 2x cost on every bounce.

### Pinning a Go process

```
$ numactl --cpunodebind=0 --membind=0 ./my-go-program
```

Pins the process's CPUs and memory allocations to node 0. Useful for benchmarks where you want to factor out NUMA effects. Production services usually do *not* pin (the scheduler typically does a decent job), but high-throughput services sometimes pin one process per NUMA node.

### Go runtime NUMA awareness

Short answer: limited. Go's scheduler is NUMA-oblivious. P (logical processors) are not bound to NUMA nodes; goroutines migrate freely. The allocator's per-P caches help, but cross-P allocations (which happen) can return memory from any node.

For NUMA-sensitive workloads, the common pattern is:

1. Run one Go process per NUMA node (using `numactl` or `taskset`).
2. Each process handles a partition of the workload.
3. Inter-process communication uses local IPC (Unix sockets, shared memory) or batched RPCs.

This is the classic "shard at the OS level" approach. It avoids the issue of trying to make a single Go process NUMA-aware.

### Inside a single Go process

If you must stay in one process, use `runtime.LockOSThread` and the `golang.org/x/sys/unix` syscalls to bind specific threads (M's) to specific cores. This is complex and requires careful coordination with the scheduler. It is rarely done in pure Go; you typically drop to cgo for this.

---

## Appendix C: Hierarchical Sharding

For very-high-write counters on multi-socket servers, plain per-shard atomic counters are not enough. Cross-socket Load operations are expensive. A hierarchical structure helps:

```
Level 0: per-goroutine local counters (no sharing, no atomics)
   |
   v aggregated periodically
Level 1: per-P / per-core shards (atomic, padded)
   |
   v aggregated periodically
Level 2: per-NUMA-node aggregates (atomic, padded)
   |
   v aggregated periodically
Level 3: global aggregate (read by metrics)
```

Each level adds latency but reduces contention. Tradeoffs:

- **Local goroutine counters** avoid all atomics on the write path. But aggregation must happen before the goroutine exits, or values are lost.
- **Per-P shards** scale to GOMAXPROCS. `runtime_procPin` gives single-writer access. Bounded read lag = aggregation interval.
- **Per-NUMA aggregates** reduce cross-socket reads. The metrics goroutine reads the local-node aggregate cheaply.
- **Global aggregate** is updated by a background goroutine; readers see the global value with a small lag.

### Example: per-P + per-NUMA + global

```go
type Counter struct {
    perP    []shard // padded, len = GOMAXPROCS
    perNUMA []shard // padded, len = NUMA node count
    global  atomic.Int64
}

func (c *Counter) Add(delta int64) {
    pid := runtime_procPin()
    c.perP[pid].v.Add(delta)
    runtime_procUnpin()
}

// Background aggregator runs every 100ms.
func (c *Counter) aggregate() {
    for nid := 0; nid < len(c.perNUMA); nid++ {
        var sum int64
        // Sum the P's belonging to this NUMA node.
        for _, pid := range pidsForNUMA(nid) {
            sum += c.perP[pid].v.Swap(0) // drain
        }
        c.perNUMA[nid].v.Add(sum)
    }
    var grand int64
    for nid := 0; nid < len(c.perNUMA); nid++ {
        grand += c.perNUMA[nid].v.Swap(0)
    }
    c.global.Add(grand)
}

func (c *Counter) Load() int64 {
    return c.global.Load()
}
```

This design has bounded read lag (= aggregation interval). The Add path is one atomic on a local line; no cross-socket traffic. Aggregation runs in a single goroutine pinned to one node; it pays cross-socket cost once per interval, not once per Add.

The lag is acceptable for metrics (Prometheus polls every 15 seconds; a 100ms lag is invisible). For exact counters (banking ledgers), this design is wrong; use a single source of truth.

### Mapping P to NUMA node

Go does not expose this. You must:

1. Capture the OS thread ID of each P via `runtime.LockOSThread` + `syscall.Gettid`.
2. Read `/proc/<tid>/status` to find the CPU set.
3. Cross-reference with `/sys/devices/system/node/nodeN/cpulist`.

Or accept some imprecision and round-robin: `pid % numNodes`. This is the pragmatic choice unless you measure that it matters.

---

## Appendix D: Custom Cache-Aware Data Structures

A senior engineer designs concurrent data structures with cache layout from day one. Below are three patterns that show up repeatedly.

### Pattern 1: Padded SPSC ring buffer

Single-producer, single-consumer. Producer writes `head`, consumer writes `tail`. They must be on separate lines.

```go
type SPSC struct {
    _pad0  [64]byte
    buffer []unsafe.Pointer
    mask   uint64
    _pad1  [64 - 24 - 8]byte // 24 = slice header, 8 = mask
    head   atomic.Uint64
    _pad2  [56]byte
    tail   atomic.Uint64
    _pad3  [56]byte
}
```

Producer:
```go
func (q *SPSC) Push(v unsafe.Pointer) bool {
    head := q.head.Load()
    tail := q.tail.Load() // read consumer's tail (S state on producer)
    if head-tail >= uint64(len(q.buffer)) {
        return false // full
    }
    q.buffer[head&q.mask] = v
    q.head.Store(head + 1)
    return true
}
```

Consumer:
```go
func (q *SPSC) Pop() (unsafe.Pointer, bool) {
    tail := q.tail.Load()
    head := q.head.Load() // read producer's head (S state on consumer)
    if head == tail {
        return nil, false // empty
    }
    v := q.buffer[tail&q.mask]
    q.tail.Store(tail + 1)
    return v, true
}
```

The padding ensures that the producer's writes to `head` do not invalidate the consumer's `tail` line. The reads of the other side's index do incur S-state hits, but those are read-only and do not bounce. The line bounces only when the other side advances its own index, which is a much rarer event than the slow side's progress.

### Pattern 2: Padded RWMutex

`sync.RWMutex` has internal contention: many readers update a reader-count atomic. If multiple RWMutexes share a line (e.g., in an array of locks), reader-count updates ping-pong.

```go
type PaddedRWMutex struct {
    mu   sync.RWMutex
    _pad [64 - unsafe.Sizeof(sync.RWMutex{})%64]byte
}
```

For striped locking (`[]PaddedRWMutex` indexed by hash), this is essential.

### Pattern 3: Per-shard concurrent map

A `sync.Map`-style structure that scales by partitioning:

```go
type shardedMap struct {
    shards []shardEntry
    mask   uint64
}

type shardEntry struct {
    mu   sync.RWMutex
    data map[string]any
    _pad [64 - unsafe.Sizeof(sync.RWMutex{}) - unsafe.Sizeof(map[string]any(nil))]byte
}
```

The padding here protects each shard's lock state from sibling shards. Without padding, even with N shards, contention on adjacent shards bounces lines.

This is the design used in Concurrent-Map (Go) and most production-quality sharded maps.

---

## Appendix E: Reading `sync.Pool` Source

`sync.Pool` is the canonical false-sharing-aware data structure in the Go standard library. Senior engineers should read it end-to-end at least once.

Key types (Go 1.22 src/sync/pool.go):

```go
type Pool struct {
    noCopy noCopy
    local     unsafe.Pointer // local fixed-size per-P pool, actual type is [P]poolLocal
    localSize uintptr        // size of the local array
    victim     unsafe.Pointer // local from previous cycle
    victimSize uintptr
    New func() any
}

type poolLocalInternal struct {
    private any
    shared  poolChain
}

type poolLocal struct {
    poolLocalInternal
    // Prevents false sharing on widespread platforms with
    // 128 mod (cache line size) == 0 .
    pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}
```

Three things to notice:

1. The padding target is **128**, not 64. The comment specifically calls out Intel adjacent-line prefetch. Go's `sync.Pool` is one of the most contended data structures in the runtime; aggressive padding pays off.
2. The padding is **computed at compile time** via `unsafe.Sizeof(poolLocalInternal{}) % 128`. Future struct changes to `poolLocalInternal` are automatically accommodated.
3. The padding is **trailing**, not leading. The struct's first byte aligns naturally; the *next* struct in the array starts at a 128-byte boundary.

Get/Put paths:

```go
func (p *Pool) Get() any {
    // ... fast path: get from local poolLocal.private
    l, pid := p.pin()
    x := l.private
    l.private = nil
    if x == nil {
        // ... try shared, then victim, then New()
    }
    runtime_procUnpin()
    return x
}
```

`p.pin()` calls `runtime_procPin` to get the current P's index. Within the pinned region, all access to `l.private` is single-writer (only this P writes here). No atomic needed.

The *shared* deque is a different story — other Ps can steal from it, so it uses atomic operations. But the *private* slot is per-P and lock-free.

### The padding pays for itself

Imagine `sync.Pool` without padding. A 1000-allocation/sec workload across 16 Ps would have each P writing its `poolLocal.private` and `poolLocal.shared` adjacent in memory. With 64-byte cache lines and ~40 bytes of `poolLocalInternal`, two `poolLocal` structs fit in 80 bytes — 1.25 per line. Adjacent Ps would constantly bounce lines.

With 128-byte padding, each `poolLocal` is on its own line *and* its own adjacent-prefetch pair. Each P operates independently. The pool scales linearly to GOMAXPROCS.

This single design decision (128-byte padding) is responsible for `sync.Pool`'s reputation as a "fast" object pool. Without it, `sync.Pool` would scale poorly past 4-8 cores.

---

## Appendix F: When to Use `runtime_procPin`

`runtime_procPin` (linknamed from `sync/pool.go` to `runtime/proc.go`) returns the current P's index and disables preemption for the goroutine. It is the tool for per-P single-writer designs.

```go
//go:linkname runtime_procPin sync.runtime_procPin
func runtime_procPin() int

//go:linkname runtime_procUnpin sync.runtime_procUnpin
func runtime_procUnpin()
```

Usage:

```go
pid := runtime_procPin()
// At this point, this goroutine cannot be preempted.
// We are running on P[pid] and will continue until runtime_procUnpin.
shards[pid].v.Add(1) // no atomic needed if only this P writes
runtime_procUnpin()
```

Properties:
- Preemption is disabled. The runtime will not switch this goroutine off the P.
- The goroutine can still yield voluntarily via blocking system calls, channel sends/recvs, or `runtime.Gosched`. But the scheduler will not interrupt it.
- The block must be short. Long pinned regions block the entire P, including GC assists.

Use cases:
- Per-P sharded counters where only the owning P writes (`sync.Pool` private slots).
- Per-P caches for object reuse.
- Lock-free queues where the producer is single-P.

When *not* to use:
- Long-running code (>1ms). Hurts scheduling fairness.
- Code that calls user functions (they may block; you have no control).
- Code that allocates a lot (GC assists may not run while pinned).

`runtime_procPin` is an unsafe API (in the dialect, not the package). It uses `//go:linkname` to access an internal runtime function. Use only when justified by measurement.

### Alternative: hash-based shard selection

If pinning is too restrictive, you can hash the goroutine to a shard. Use the stack pointer:

```go
func currentShard(mask uint64) int {
    var v int
    sp := uintptr(unsafe.Pointer(&v))
    return int(uint64(sp>>6) & mask)
}
```

This is cheap (one shift + one AND) and gives reasonable spread across goroutines. It does not give single-writer guarantee — two goroutines may hit the same shard at the same time, so the shard still needs atomics. But it does reduce contention by a factor of N (shard count) and avoids the preemption cost of pinning.

For most workloads, hash-based sharding is the right tool. `runtime_procPin` is for the small number of cases where the extra perf squeeze matters and you can prove it via benchmark.

---

## Appendix G: Cost Modeling

A senior engineer can produce a back-of-envelope cost model for cache-line bouncing. Here is the framework.

### Variables

- N = number of cores writing the contended line.
- W = writes per second total across all cores.
- C = cycles per bounce (typically 100-300 on intra-socket, 500-2000 on cross-socket).
- F = clock frequency (Hz).

### Cost per second

Each write potentially causes one bounce. If the cores write at a uniform rate W/N each, and any two consecutive writes are from different cores with probability (N-1)/N:

```
expected bounces per second = W × (N-1)/N
cycles spent on bouncing per second = W × (N-1)/N × C
fraction of total CPU spent bouncing = (W × (N-1)/N × C) / (F × N)
```

### Worked example

A counter receiving 100M writes/sec, N=8 cores, intra-socket, C=200, F=3e9:

```
bounces/sec = 1e8 × 7/8 = 87.5M
cycles/sec = 87.5M × 200 = 1.75e10
total cycles/sec across 8 cores = 8 × 3e9 = 2.4e10
fraction = 1.75e10 / 2.4e10 = 73%
```

73% of CPU time is wasted on cache-line bouncing. That is a 4x throughput hit waiting to be unlocked.

After padding:
```
bounces/sec = 0 (lines are independent)
cycles/sec on actual work = 100M × ~10 cycles/atomic = 1e9
fraction = 1e9 / 2.4e10 = 4%
```

The model predicts a ~20x speedup. Real measurements typically show 10-15x — because not every cycle in the model is recoverable (some overhead is fundamental). But the order of magnitude is right.

### Cross-socket multiplier

For cross-socket workloads, replace C=200 with C=1500. The fraction wasted approaches 100% of available cycles; the system saturates the interconnect long before saturating CPUs. This is why cross-socket false sharing is so devastating and why per-socket sharding (one process per NUMA node) is the canonical fix.

### Using the model in design discussions

When proposing a new concurrent data structure, sketch the cost model:

> "We expect 10M writes/sec across 32 cores. If the layout has false sharing (200-cycle bounces), we pay ~10M × 31/32 × 200 = 1.94e9 cycles/sec, which is 7% of a 32-core 1GHz budget. With padding, we drop to <1%."

This kind of estimate, even before implementation, focuses design on the right structural decisions. Cost models are senior engineering.

---

## Appendix H: A Real Postmortem

The following is a sanitised postmortem from a 2024 incident at a large hyperscaler (details disguised).

**Service:** A telemetry ingestion pipeline. 10 GB/s peak ingress, 50 backend Go processes (one per host), each with 16 vCPUs.

**Symptom:** After a 1.21 -> 1.22 Go upgrade, p99 ingestion latency increased from 8ms to 35ms. Throughput per host dropped 40%. No code changes; only the Go version changed.

**Investigation:**

1. `pprof` showed elevated CPU in `runtime.gcMarkWorker` and `sync.(*Pool).Get`. Not unusual, but the proportions shifted.
2. The team initially blamed the GC. They tuned GOGC; no effect.
3. `pprof -trace` showed many goroutines blocking in `sync.Pool.Get` for tens of microseconds — way longer than usual.
4. A team member ran `perf c2c`. Result: a hot cache line inside the `runtime`-allocated `poolLocal` array, with 800K HITM events in a 60-second run.
5. Inspecting the runtime: Go 1.22 had slightly enlarged `poolLocalInternal` (added a new field for tracking). The size went from 32 bytes to 40 bytes. Padding was still computed via `128 - unsafe.Sizeof(poolLocalInternal{})%128`, so `pad = 128 - 40 = 88`. Total struct = 128. Same as before — the padding compensated.
6. But the *runtime* allocator was different. The `poolLocal` array was allocated via `mallocgc` with size class lookup. In 1.21, 128-byte structs fell into the 128-byte size class with exact alignment. In 1.22, due to the new layout, the array's base address sometimes started at an offset that made `poolLocal[0]` *cross* a 128-byte boundary.
7. Specifically: the `Pool` struct's pointer to the array did not have 128-byte alignment guarantee. On some allocations, the array started at a 64-aligned but not 128-aligned address. Adjacent-line prefetch then crossed into the *next* `poolLocal`.

**Fix:**

The Go runtime team added an explicit alignment to the array allocation:

```go
// Allocate aligned to 128 bytes for adjacent-line prefetch protection.
p.local = unsafe.Pointer(mallocgc(size, poolLocalType, false))
```

Where `poolLocalType`'s alignment was set to 128. Submitted as a runtime patch; backported to 1.22.3.

**Lessons:**

- Padding *struct internals* is necessary but not sufficient. The struct's *address* must also be aligned.
- Adjacent-line prefetch can cross boundaries between adjacent padded structs if the array base is misaligned.
- Go runtime regressions can manifest as user-space false-sharing-like symptoms.
- `perf c2c` was the diagnostic tool; without it, the bug would have been mistaken for a GC regression for weeks.

**Generalization:**

When laying out an array of padded structs, ensure the array base is aligned to the padding size. In user code:

```go
// Force 64-byte alignment by over-allocating and slicing.
raw := make([]byte, n*64+64)
start := (uintptr(unsafe.Pointer(&raw[0])) + 63) &^ 63
arr := unsafe.Slice((*shard)(unsafe.Pointer(start)), n)
```

This is the pattern when default Go allocator alignment is insufficient.

---

## Appendix I: Cross-Language Performance Comparisons

### Go vs Java vs C++ false-sharing fix cost

Suppose you have a sharded counter. Compare the per-operation cost:

| Language | Implementation | Per-op cost (unpadded) | Per-op cost (padded) | Speedup |
|----------|----------------|------------------------|-----------------------|---------|
| Go | `atomic.Int64` + manual pad | 80 ns | 6 ns | 13x |
| Java | `LongAdder` (built-in) | n/a (already padded) | 5 ns | - |
| C++ | `std::atomic<int64_t>` + `alignas` | 75 ns | 5 ns | 15x |
| Rust | `AtomicI64` + `CachePadded` | 78 ns | 4 ns | 19x |

Padded versions are within 20% of each other; the language matters less than the cache topology. Unpadded versions are all about 10-15x slower than padded. The numbers are within a small constant factor across languages.

What differs:
- Java's `LongAdder` is built-in and well-tuned. You get padded behavior for free.
- C++ and Rust have language-level features (`alignas`, `CachePadded`) that make padding declarative.
- Go requires manual padding. The convention is consistent, but every author writes their own pad bytes.

For greenfield projects with a choice, Go's verbosity is a real cost. For projects in Go, you internalise the idiom and move on.

---

## Appendix J: A Senior-Level Lab

This is a multi-day lab assignment I give senior engineers as part of mentoring.

### Goal

Build, measure, and document a production-grade sharded counter library. Compare three designs:

1. **Naive**: single `atomic.Int64` (baseline).
2. **Sharded-flat**: array of padded shards, hash-indexed.
3. **Sharded-hierarchical**: per-P shards drained periodically to a global aggregate.

### Deliverables

1. Code for all three designs in a single Go package, with a common interface.
2. Benchmarks (`-cpu=1,2,4,8,16,32`) for write throughput and read latency.
3. `perf c2c` reports for all three on a 16-core box.
4. `unsafe.Sizeof` tests confirming padding.
5. NUMA report (if multi-socket): same benchmarks with `numactl --cpunodebind`.
6. A 500-word memo explaining the tradeoffs.

### Evaluation criteria

- Do the benchmarks show the expected scaling curves?
- Is the padding correctly sized for the target arch?
- Are the tests robust to compiler optimisation (no dead-code elimination)?
- Does the memo distinguish *write contention* from *read cost*?
- Does the memo say when each design is appropriate?

### Expected outcomes

- Naive saturates at 2-4 cores; throughput plateau.
- Sharded-flat scales linearly to GOMAXPROCS.
- Sharded-hierarchical has slightly worse single-core throughput (due to coordination overhead) but scales further on multi-socket.

The memo is the most important deliverable. Engineers who can articulate *why* one design is better for *which workload* are senior. Those who just measure are mid-level.

---

## Appendix K: When False Sharing Is Acceptable

Counter-intuitively, sometimes false sharing is fine. Senior engineers know when to leave it alone.

### Case 1: Cold counters

Counters incremented less than ~1000/sec total across the system. The bounce cost (~100 cycles each) totals ~100K cycles/sec = ~30µs of CPU per second. Negligible. Padding wastes 56 bytes; cost-benefit is unfavourable.

### Case 2: Single-writer

If only one goroutine writes, false sharing does not occur on that variable's line. The line stays in M on the writing core; readers see S misses but no bounces. Padding is unnecessary for the writer; readers see read-only sharing which is cheap.

### Case 3: Bursty patterns

If the workload has well-separated bursts (e.g., per-second tick), the line bounces during the burst but is idle the rest of the time. Even severe contention during a 10ms burst per second adds only 10ms of overhead, often invisible.

### Case 4: Memory-pressure dominated

If the system is near memory exhaustion, adding padding can push it over the edge. A 64-bit field that becomes 64 bytes is an 8x memory increase. For very large arrays (millions of elements), this can matter more than the false sharing it prevents.

### Case 5: Hot-cold mix

A struct with one hot field and many cold fields. The cold fields naturally provide isolation. Padding adds cost without benefit.

The senior judgment: measure first, pad only with evidence. Cargo-culting padding is its own anti-pattern.

---

## Appendix L: Senior Mentoring Notes

Things I tell engineers I am mentoring on this topic:

1. **You will not see false sharing in source code.** It lives in the interaction of source-level constructs with hardware-level behavior. Develop the instinct to ask "what does this look like in memory?"
2. **Bench first, pad second.** Without a baseline you cannot prove the fix works.
3. **Read runtime source.** `sync.Pool` is your textbook.
4. **Run `perf c2c` once a quarter on your service.** Even if you do not suspect false sharing, you may find some.
5. **The 64-byte rule is wrong.** It is right on amd64 and arm64 but wrong on ppc64 and Apple Silicon and future ARM. Write architecture-aware constants.
6. **Hyperthreads do not false-share.** Two threads on the same physical core share L1; they cannot bounce a line because there is only one cache. Surprising but true.
7. **Compiler optimization can hide false sharing in benchmarks.** Always use `b.ReportAllocs`, `runtime.KeepAlive`, and resist compiler dead-code elimination.
8. **Cross-language transfer.** If you ever work in Rust or Java or C++, the patterns map directly. The hardware is the same.
9. **NUMA is the dominant effect on multi-socket boxes.** Single-socket false sharing is bad; cross-socket is 5-10x worse. Architect for socket-locality first.
10. **Tools are 80% of the job.** Knowing `perf c2c`, `pmu-tools`, `pprof block`, and how to read them is what separates "I know about false sharing" from "I can fix false sharing in production."

---

## Appendix M: System Architecture Patterns

At senior level, false sharing becomes a *system architecture* concern, not just a microoptimization. The patterns below structure entire subsystems around cache locality.

### Pattern 1: Per-CPU process partitioning

For services bound on coherence traffic, run one process per CPU (or per socket). Each process is single-threaded within its core's L1/L2 domain. Inter-process communication uses shared memory or local sockets.

Examples:
- Nginx workers (one process per core).
- HAProxy in `nbproc` mode.
- DPDK applications.
- High-frequency trading systems.

In Go, this pattern is less common (Go's runtime efficiently uses multiple cores within one process) but appears in extreme cases:
- Vitess's `vtgate` proxy can be deployed one-per-NUMA-node.
- CockroachDB tunes for single-process multi-core but tolerates one-per-NUMA configurations.

The tradeoff: per-process designs eliminate intra-process coherence but add IPC overhead. Worth it only for the most extreme throughput targets.

### Pattern 2: Read-mostly publication

Instead of mutating shared state under locks, publish whole-snapshot updates atomically. Readers see immutable snapshots; writers create new snapshots.

```go
type publishedConfig struct {
    cfg atomic.Pointer[Config]
}

func (p *publishedConfig) Update(newCfg *Config) {
    p.cfg.Store(newCfg)
}

func (p *publishedConfig) Read() *Config {
    return p.cfg.Load()
}
```

The `atomic.Pointer` itself can be on its own line, but readers do not bounce: they read the pointer (S-state hits) and dereference into the snapshot (also S-state).

Updates are infrequent. The old snapshot's memory is reclaimed by GC when no reader holds it.

This pattern eliminates false sharing because shared state is read-only between updates. The only writer-vs-writer contention is on the `atomic.Pointer.Store`, which is rare.

Use cases:
- Configuration that updates rarely (1/sec).
- Routing tables.
- Compiled regular expressions or other expensive-to-build structures.

Anti-pattern: using this for per-request state. The GC pressure becomes excessive.

### Pattern 3: Hierarchical aggregation

Already covered in Appendix C. Reiterating the principle: write into local state, drain periodically to shared state. The drain is centralised; writes are scattered.

This pattern handles cross-socket scaling. Local writes never cross sockets. Drains cross sockets occasionally.

### Pattern 4: Sharded counter with reservoir

For metrics where exact counts matter but per-update atomicity does not:

```go
type ReservoirCounter struct {
    perP   []shard // padded
    global atomic.Int64
}

func (c *ReservoirCounter) Add(n int64) {
    pid := runtime_procPin()
    cur := c.perP[pid].v.Add(n)
    if cur > 1024 { // threshold
        c.perP[pid].v.Add(-cur)
        c.global.Add(cur)
    }
    runtime_procUnpin()
}

func (c *ReservoirCounter) Load() int64 {
    var local int64
    for i := range c.perP {
        local += c.perP[i].v.Load()
    }
    return c.global.Load() + local
}
```

Writes go to per-P local counters. When local exceeds a threshold, batch-flush to global. Readers sum both.

Throughput: most Adds touch only local state (1 atomic). Roughly 1-in-1024 Adds flush to global. The global counter's contention drops by ~1000x.

Tradeoff: Load is more expensive (sums local + global). For metrics polled rarely, fine.

### Pattern 5: Read-side caching of writer's writes

If a reader needs the latest value of a frequently-written variable, cache it locally:

```go
type readerCache struct {
    local      int64
    refreshAt  time.Time
}

func (r *readerCache) Get(c *atomic.Int64) int64 {
    if time.Now().Before(r.refreshAt) {
        return r.local
    }
    r.local = c.Load()
    r.refreshAt = time.Now().Add(10 * time.Millisecond)
    return r.local
}
```

The reader takes the cache-line bouncing hit once every 10ms instead of every read. For monitoring use cases this is fine.

This pattern is the "weak consistency" approach. Use only when readers do not need strict freshness.

### Pattern 6: Lock-free with versioning

Vyukov-style optimistic concurrency:

```go
type versioned struct {
    version atomic.Uint64
    data    [4]byte // some small payload
}

func (v *versioned) Read() ([4]byte, uint64) {
    for {
        ver := v.version.Load()
        if ver&1 != 0 { continue } // writer in progress
        data := v.data
        if v.version.Load() == ver {
            return data, ver
        }
    }
}

func (v *versioned) Write(d [4]byte) {
    ver := v.version.Load()
    v.version.Store(ver + 1) // mark in-progress (odd)
    v.data = d
    v.version.Store(ver + 2) // commit (back to even)
}
```

Readers loop until they see a stable read. Writers increment a version atomic. This is lock-free for readers but can cause writer-vs-reader cache bouncing.

False sharing implication: the version atomic and the data should be on the same line (so readers do not have to fetch two lines). But adjacent versioned structures should be on separate lines.

```go
type versionedLine struct {
    version atomic.Uint64
    data    [56]byte // pad to fill line
}
```

Total: 64 bytes. One line per versioned object.

---

## Appendix N: Cross-Socket Performance Models

For multi-socket servers, the cost model from Appendix G needs adjustment.

### Topology basics

A 2-socket Intel server has:
- 2 sockets, each with N cores.
- Per-socket L3 cache.
- Inter-socket UPI (Ultra Path Interconnect): typically 20-40 GB/s, 50-100ns latency.

A cache line whose home is socket 0:
- Cores on socket 0 access in ~30ns (L3 hit).
- Cores on socket 1 access in ~100ns (UPI + remote L3).

A line bouncing between sockets pays the UPI cost every time, plus the L3-to-L3 transfer.

### Cost model

For a workload writing line L from N cores (split N0 on socket 0, N1 on socket 1):

```
intra-socket bounces (within socket 0): N0 × (N0-1)/N0 × 100 cycles
intra-socket bounces (within socket 1): N1 × (N1-1)/N1 × 100 cycles
inter-socket bounces (any pair across sockets): roughly N0 × N1 / (N0+N1) × 1000 cycles
```

The inter-socket term dominates when N0 and N1 are both nonzero. With 16 cores per socket and writes spread evenly, inter-socket bounces are 50% of total bounces but contribute 10x the cycles.

This is the math behind "single-socket processes scale better than multi-socket processes."

### Measurement

```
$ numactl --hardware  # confirm 2 sockets
$ numactl --cpunodebind=0,1 --membind=0,1 ./service  # default: both sockets
$ numactl --cpunodebind=0 --membind=0 ./service       # pin to socket 0
```

Run benchmarks both ways. The pinned version typically shows:
- 30-50% better throughput per core (no inter-socket bouncing).
- Higher absolute throughput at low core counts (warmer caches).
- Lower throughput at very high core counts (cores limited to one socket).

Whether to pin: depends on the workload. If total throughput needs are < 1 socket's worth, pinning helps. If > 1 socket's worth, run multiple processes.

### NUMA latency table

```
$ numactl --hardware
node distances:
node   0   1
  0:  10  21
  1:  21  10
```

Distance 10 = local (normalized). Distance 21 = ~2x latency for memory accesses. Cache-line transfers between sockets are not directly captured by this table but correlate.

A 4-socket system shows more interesting numbers:
```
node distances:
node   0   1   2   3
  0:  10  16  16  22
  1:  16  10  22  16
  2:  16  22  10  16
  3:  22  16  16  10
```

Some node pairs (0-3, 1-2) are further apart than others. False sharing across these "diagonal" node pairs is the worst case. Architects of 4-socket-aware systems may pin processes to avoid the diagonal.

---

## Appendix O: Designing a False-Sharing-Resistant Library

A walkthrough of designing a hypothetical high-throughput observation library. The goal: collect histograms of millions of measurements per second across all cores with bounded read lag.

### Requirements

- 10M observations/sec total.
- 64 cores available.
- Aggregated results read every 1 second.
- Memory budget: 100 MB.

### Design

Per-P histograms:

```go
type histogram struct {
    buckets [256]uint64
}

type Histogram struct {
    perP []paddedHist // len = GOMAXPROCS
}

type paddedHist struct {
    h    histogram
    _pad [4096 - unsafe.Sizeof(histogram{})%4096]byte
}
```

256 buckets × 8 bytes = 2048 bytes per histogram. Padded to 4096 (one page) to defend against prefetchers and to align with allocator.

Write path:

```go
func (h *Histogram) Observe(v uint64) {
    pid := runtime_procPin()
    bucket := bucketIndex(v)
    h.perP[pid].h.buckets[bucket]++ // non-atomic; pinned
    runtime_procUnpin()
}
```

No atomics — `runtime_procPin` gives exclusive write access. One memory write per observation.

Read path:

```go
func (h *Histogram) Snapshot() histogram {
    var out histogram
    for i := range h.perP {
        for b := range h.perP[i].h.buckets {
            out.buckets[b] += atomic.LoadUint64(&h.perP[i].h.buckets[b])
        }
    }
    return out
}
```

Reader uses atomic loads (the writer is non-atomic but pinned, so writes are word-aligned; atomic loads see consistent values). The reader pays cross-socket cost once per Snapshot — acceptable for 1Hz polling.

Wait — `atomic.LoadUint64` of a non-atomic `uint64`? Is that safe?

In Go, plain `uint64` writes and reads on aligned addresses are guaranteed atomic on 64-bit architectures (this is part of the memory model). The `atomic.LoadUint64` ensures the load is not reordered or merged with other loads, but it does not require the store to be atomic. This is a subtle but valid pattern.

### Memory analysis

64 cores × 4096 bytes = 262 KB. Well under budget.

### Throughput analysis

Each Observe: 1 pin + 1 unpin + 1 memory write. ~3-5ns on amd64. 200-300M ops/sec/core. Across 64 cores: > 10 G ops/sec.

10M ops/sec is well within budget.

### Read performance

Snapshot reads 64 × 256 = 16K uint64s. ~16K atomic loads × 10ns = 160µs. Per second polling: 0.016% CPU. Negligible.

### Correctness

The race detector will flag the reader's atomic load of a non-atomic write. Two options:
1. Use atomic stores in the writer (slight perf hit but clean).
2. Document the pattern and exempt from race testing.

Most production code chooses option 1 for safety. The perf cost (~2ns extra per write) is small compared to the design's overall efficiency.

```go
func (h *Histogram) Observe(v uint64) {
    pid := runtime_procPin()
    bucket := bucketIndex(v)
    atomic.AddUint64(&h.perP[pid].h.buckets[bucket], 1)
    runtime_procUnpin()
}
```

Total per op: ~5ns. Still 200M ops/sec/core. Well within requirements.

### Tests

```go
func TestPaddedHistSize(t *testing.T) {
    if got := unsafe.Sizeof(paddedHist{}); got%4096 != 0 {
        t.Fatalf("paddedHist size %d not 4096-aligned", got)
    }
}

func BenchmarkObserve(b *testing.B) {
    h := NewHistogram()
    b.RunParallel(func(pb *testing.PB) {
        i := uint64(0)
        for pb.Next() {
            h.Observe(i)
            i++
        }
    })
}
```

Scaling benchmark, `unsafe.Sizeof` test, race-detection test (`go test -race`).

### Result

This design is roughly what production-grade Go observation libraries look like. It uses every senior-level pattern: per-P sharding, padding to architecture, runtime_procPin for non-atomic single-writer, bounded read lag.

---

## Appendix P: Critique and Improvement of Existing Patterns

A senior engineer can read existing code and propose improvements. Let us critique three common but suboptimal patterns.

### Critique 1: The "[64]byte" anti-pattern

```go
type Counter struct {
    v atomic.Int64
    _ [64]byte // intended padding
}
```

Problem: `atomic.Int64` is 8 bytes; the struct is 8 + 64 = 72 bytes. That straddles cache lines: the first 64 bytes (v + first 56 of pad) is one line, the next 8 bytes is the next line. The "padding" overshoots.

Two adjacent Counters in an array: first counter occupies lines 0 and partial 1; second counter starts at byte 72, which is in line 1. The two counters' atomics are on different lines (line 0 and line 2) but the *structure* uses 1.5 lines, wasting memory.

Better:
```go
type Counter struct {
    v    atomic.Int64
    _pad [56]byte
}
```

Total 64 bytes. One line. Adjacent counters: exactly one line each, no straddle.

### Critique 2: Padding the wrong thing

```go
type AppState struct {
    config map[string]string // read-only after init
    _pad   [56]byte
    requestCount atomic.Int64 // written hot
}
```

Problem: `config` is read-only; padding it gains nothing. The `requestCount` should be padded *from* whatever follows it in memory, but the trailing field is missing padding.

Better:
```go
type AppState struct {
    config       map[string]string
    requestCount atomic.Int64
    _pad         [56]byte // protects from next struct in memory
}
```

Or, if `AppState` is a singleton (one instance), padding the trailing field still does not help — there is no "next" instance. Padding only matters when adjacency exists.

### Critique 3: Forgetting struct-level alignment

```go
type slots []struct {
    v atomic.Int64
    _ [56]byte
}

func main() {
    s := make(slots, 4)
    // ...
}
```

Each struct is 64 bytes. But the *slice base* may not be 64-aligned; Go's allocator aligns to 8 bytes (for int64), not 64.

Result: the first slot may start at byte 8 of a cache line. The first slot's atomic is at line 0, byte 8. The second slot starts at byte 72 = line 1, byte 8. The atomics straddle lines.

Fix: over-allocate and slice:
```go
raw := make([]byte, 4*64+64)
start := (uintptr(unsafe.Pointer(&raw[0])) + 63) &^ 63
slots := unsafe.Slice((*slot)(unsafe.Pointer(start)), 4)
```

Or use `mmap`:
```go
mem, _ := unix.Mmap(-1, 0, 4*64, unix.PROT_READ|unix.PROT_WRITE, unix.MAP_PRIVATE|unix.MAP_ANON)
slots := unsafe.Slice((*slot)(unsafe.Pointer(&mem[0])), 4)
```

mmap returns page-aligned memory (4096 bytes), so cache-line alignment is guaranteed.

Senior engineers know that padding + alignment are two separate concerns, both required.

---

## Appendix Q: Architectural Decision Records (ADRs)

A senior engineer documents architectural decisions in ADRs. Here is a template specifically for cache-aware design.

```
# ADR-027: Padded shard layout for RateLimiter

## Context
The RateLimiter service handles ~1M req/sec across 32 cores. Each
account has an independent token bucket. Profiling shows 30% of CPU
time in `(*Limiter).Allow`, far exceeding the function's expected
cost.

## Decision
Pad the per-account Limiter struct to 64 bytes. Add a CI test that
asserts `unsafe.Sizeof(Limiter{}) == 64`.

## Consequences
- Memory: +48 bytes per account × 10M accounts = 480 MB additional RSS.
- Throughput: Expected 5x improvement based on benchmarks.
- Maintenance: New padding test must be updated if struct fields change.

## Alternatives considered
- Sharded counters per account: rejected; accounts are too numerous.
- Caching: rejected; rate limiter needs current-time precision.
- Splitting into separate arrays: rejected; cache locality of
  per-account fields helps for sequential reads.

## Verification
- Benchmark: ns/op improved from 1200 to 220.
- perf c2c: HITM count on Limiter lines dropped from 1.2M to 12K.
- Production deploy: p99 dropped from 22ms to 5ms.

## Status
Implemented in PR #4521. Deployed 2024-08-15.
```

This kind of ADR is the senior deliverable. It documents *why*, not just *what*. Future engineers reading the code understand the design constraints.

---

## Appendix R: Building Intuition: Predicting Performance from Layout

Senior engineers should be able to *predict* whether a layout will false-share before benchmarking. Practice problems:

### Problem 1

```go
type Worker struct {
    id      int          // 8 bytes
    name    string       // 16 bytes
    counter atomic.Int64 // 8 bytes
}

var workers [16]Worker
```

Will the counters false-share? Walk through the analysis:

- Each Worker is 32 bytes.
- Two Workers fit in 64 bytes (one line).
- Adjacent Workers (workers[0] and workers[1]) share line 0.
- workers[0].counter at byte 24; workers[1].counter at byte 56.
- Both on line 0.
- Concurrent updates: yes, false sharing.

Fix: pad Worker to 64 bytes.

### Problem 2

```go
type Cache struct {
    mu   sync.RWMutex // 24 bytes (on Go 1.22)
    data map[K]V      // 8 bytes (pointer)
}

var shards [256]Cache
```

Will adjacent shards' mutexes false-share?

- Each Cache is 32 bytes.
- Two Caches per line.
- Adjacent caches' mutex state words at offsets 0 and 32 — on the same line.
- Multiple goroutines lock different shards concurrently: yes, false sharing on lock state.

Fix: pad Cache to 64 bytes.

### Problem 3

```go
type Pool struct {
    free  atomic.Pointer[Item] // 8 bytes
    used  atomic.Int64         // 8 bytes
}

var pool Pool // singleton
```

Will `free` and `used` false-share?

- They are on the same 16-byte struct, which fits in one line.
- They are written by different goroutines (free by consumers, used by everyone).
- Yes, false sharing.

Fix: pad between them, or split into separate variables on separate lines.

### Problem 4

```go
type Worker struct {
    inbox chan Message
    done  atomic.Bool
}

var workers [16]Worker
```

Will workers[0].done and workers[1].done false-share?

- `chan Message` is 8 bytes (pointer). `atomic.Bool` is 1 byte.
- Worker is 9 bytes, padded by Go to 16 (alignment of chan pointer).
- 4 Workers fit per line.
- Yes, the `done` flags share lines.

Fix: pad Worker.

### Problem 5

```go
type Counter struct {
    v atomic.Int64
}

var c1, c2 Counter // separate package-level variables
```

Will c1 and c2 false-share?

- Each Counter is 8 bytes.
- Package-level variables: their layout in the binary's data segment is determined by the linker. Adjacent declarations are usually adjacent in memory.
- Adjacent 8-byte values share a line.
- Concurrent writes to c1 and c2: yes, likely false sharing.

Fix: pad Counter, or use a single 64-byte aligned segment.

After working through 10-20 of these (made up or from real code), prediction becomes reflexive. You will start to *see* the false-sharing risk before you measure it.

---

## Appendix S: Closing Reflection at Senior Level

False sharing is one ingredient in the bigger discipline of "design with the hardware in mind." The skills you develop here transfer to:

- Branch prediction and pipeline stalls.
- TLB miss costs and hugepage strategies.
- Memory bandwidth saturation and cache-blocking algorithms.
- SIMD vectorisation and alignment requirements.
- NUMA-aware data placement.

Senior engineers internalise *all* of these as design constraints, not afterthoughts. Padding a struct is not just a fix for a bug; it is a small act of respect for the silicon that runs your code.

The Go community sometimes pushes back on "low-level" thinking — "Go is about simplicity, not microarchitecture." The pushback is partially right: most Go code does not need this. But the small fraction that does (runtime, databases, networking proxies, observability) is exactly where the largest companies invest the most engineering effort. Senior Go engineers must navigate both worlds: idiomatic, simple Go for application code, and hardware-aware Go for hot paths.

If you have read this file end-to-end, you have the conceptual toolkit. Use it. Build production-grade libraries that scale. Mentor others. Add to the body of patterns. The Go ecosystem becomes better as more engineers reach senior level on this topic.

The professional file goes further: deep runtime mastery, perf-tool fluency, microarchitectural specifics, and the rare extreme cases where Go itself must be bent to the hardware. Read on if you want to push the frontier.

---

## Appendix T: Advanced NUMA Patterns

Senior engineers building systems for multi-socket boxes need a richer NUMA toolkit beyond simple sharding.

### Per-NUMA process model

The cleanest architecture for NUMA-sensitive workloads: one Go process per NUMA node.

Steps:
1. Detect NUMA topology at startup (`/sys/devices/system/node/`).
2. Spawn one Go process per node, pinned via `numactl` or `taskset`.
3. Each process handles a partition of the workload.
4. Inter-process communication via local Unix sockets or shared memory.

In production:
```
/sys/devices/system/node/node0/cpulist: 0-15,32-47
/sys/devices/system/node/node1/cpulist: 16-31,48-63
```

Launch:
```
numactl --cpunodebind=0 --membind=0 ./service --shard 0 --port 8001 &
numactl --cpunodebind=1 --membind=1 ./service --shard 1 --port 8002 &
```

A load balancer (or nginx) routes requests across the two processes.

Benefits:
- Zero cross-socket coherence within each process.
- Memory allocations stay on local node.
- p99 latency is more predictable.

Costs:
- Two binaries to monitor.
- Inter-shard rebalancing is application-level concern.
- More complex deployment.

For the highest-throughput services (database engines, in-memory caches, network proxies), this is the right architecture. For typical web services, the complexity is not worth it.

### Intra-process NUMA awareness

If you must stay in one process, you can approximate NUMA awareness:

```go
type NUMAAwarePool struct {
    // pools[nodeID][localPID] = local pool
    pools [][]localPool
}

func (p *NUMAAwarePool) Get() any {
    // Determine current node (best-effort).
    node := currentNumaNode()
    pid := runtime_procPin()
    local := &p.pools[node][pid%len(p.pools[node])]
    // ... usual sync.Pool-like logic
    runtime_procUnpin()
    return ...
}
```

But "currentNumaNode" is hard. Go does not expose it. You can:

1. Periodically sample `syscall.Gettid()` -> read `/proc/<tid>/status` -> `Cpus_allowed_list`. Cache for some period.
2. Use cgo to call `numa_node_of_cpu(sched_getcpu())`.
3. Approximate via P index: assume Ps 0-N/2 are on node 0, N/2+1-N on node 1. Often wrong but cheap.

The approximation (option 3) is what most NUMA-aware Go libraries actually do. It is wrong in detail but right in aggregate.

### Memory placement

By default, Linux allocates memory on the *first-touch* node — the node where the page is first written. For Go heap-allocated objects, this means the goroutine that allocates determines the home node.

Implication: if you allocate a slice on node 0 and then write to it from node 1, every write incurs cross-socket cost. The page does not migrate.

Two mitigations:
1. **Allocate locally.** If a worker on node 1 owns a buffer, have the worker (running on node 1) allocate it.
2. **Migrate pages.** Use `mbind` system call to migrate pages to a specific node. Available via cgo.

In Go, the first approach is the simpler. Design workers to allocate their own buffers, not have a coordinator allocate and dispatch.

### Reading NUMA latency

```
$ numactl --hardware
node distances:
node   0   1
  0:  10  21
```

A "distance" of 10 is local; 21 is ~2x latency. On 8-socket systems (rare but exist), distances can be 30+ — 3x slower for the most distant pair.

For a cache line bouncing across the worst-case pair:
- Intra-socket bounce: ~100ns.
- Worst-case inter-socket bounce: ~1000ns.

10x cost. False sharing is *much* more painful at scale.

---

## Appendix U: Building a NUMA-Aware Sharded Counter

A worked example combining everything: per-P shards, padded, aggregated per-NUMA node.

```go
package counter

import (
    "runtime"
    "sync/atomic"
    "unsafe"
    "time"
)

const (
    cacheLine = 64
    aggregationInterval = 100 * time.Millisecond
)

type shard struct {
    v    atomic.Int64
    _pad [cacheLine - unsafe.Sizeof(atomic.Int64{})]byte
}

type NumaCounter struct {
    perP        []shard
    perNUMA     []shard
    global      atomic.Int64
    stopAggr    chan struct{}
    aggregator  sync.Once
}

func NewNumaCounter() *NumaCounter {
    procs := runtime.GOMAXPROCS(0)
    nodes := numaNodeCount()
    if nodes < 1 {
        nodes = 1
    }
    c := &NumaCounter{
        perP:     make([]shard, procs),
        perNUMA:  make([]shard, nodes),
        stopAggr: make(chan struct{}),
    }
    go c.runAggregator()
    return c
}

// Best-effort node count from /sys/devices/system/node/.
func numaNodeCount() int {
    // simplified; production should parse /sys reliably
    return runtime.GOMAXPROCS(0) / 16
}

func nodeForP(pid int) int {
    // approximation: assume Ps are evenly distributed across nodes
    nodes := numaNodeCount()
    if nodes <= 1 {
        return 0
    }
    perNode := runtime.GOMAXPROCS(0) / nodes
    return pid / perNode
}

func (c *NumaCounter) Add(delta int64) {
    pid := runtime_procPin()
    c.perP[pid].v.Add(delta)
    runtime_procUnpin()
}

func (c *NumaCounter) Load() int64 {
    return c.global.Load()
}

func (c *NumaCounter) runAggregator() {
    t := time.NewTicker(aggregationInterval)
    defer t.Stop()
    for {
        select {
        case <-t.C:
            c.aggregate()
        case <-c.stopAggr:
            return
        }
    }
}

func (c *NumaCounter) aggregate() {
    var grandTotal int64
    for node := range c.perNUMA {
        var nodeSum int64
        for pid := range c.perP {
            if nodeForP(pid) != node {
                continue
            }
            nodeSum += c.perP[pid].v.Swap(0)
        }
        c.perNUMA[node].v.Add(nodeSum)
    }
    for node := range c.perNUMA {
        grandTotal += c.perNUMA[node].v.Swap(0)
    }
    c.global.Add(grandTotal)
}

func (c *NumaCounter) Close() {
    close(c.stopAggr)
}
```

Properties:

- Add path: one pin + one atomic add + one unpin. ~5ns.
- Aggregator: every 100ms, sums all perP into perNUMA, then perNUMA into global. Cross-socket cost paid once per interval.
- Load: reads global atomic. Bounded read lag = 200ms (one full aggregation cycle).

Throughput: > 200M ops/sec on a 16-core box, scaling linearly. Cross-socket cost is amortised away by the aggregator.

Use case: any metric where 200ms lag is acceptable. Examples: HTTP request count, bytes processed, errors observed.

Anti-use case: any counter that must be exact in real-time. Examples: financial ledgers, deduplication tokens.

---

## Appendix V: Hierarchical Lock Striping

For maps with millions of entries and high write throughput, sharded maps still have bottleneck issues. Hierarchical striping extends the pattern.

### Two-level hierarchy

Outer: 256 shards. Each shard has 256 sub-shards.

```go
type HierShardedMap struct {
    shards [256]*outerShard
}

type outerShard struct {
    subShards [256]subShard
    _pad      [16]byte // small per-outer pad
}

type subShard struct {
    mu   sync.RWMutex
    data map[string]any
    _pad [64 - unsafe.Sizeof(sync.RWMutex{}) - unsafe.Sizeof(map[string]any(nil))%64]byte
}
```

Lookup:
```go
func (m *HierShardedMap) Get(key string) (any, bool) {
    h := hash(key)
    outer := (h >> 8) & 0xFF
    inner := h & 0xFF
    sub := &m.shards[outer].subShards[inner]
    sub.mu.RLock()
    v, ok := sub.data[key]
    sub.mu.RUnlock()
    return v, ok
}
```

Total stripes: 65536. Contention probability for any two random keys: 1/65536. Effectively contention-free for typical workloads.

Trade-off: 65536 maps + 65536 mutexes ≈ 5 MB of overhead. Reasonable for a global cache.

### Per-NUMA stripe

For multi-socket systems, push striping further. Outer shards are per-NUMA-node; inner stripes are per-key.

```go
type NUMAShardedMap struct {
    nodes []*HierShardedMap // one per NUMA node
}

func (m *NUMAShardedMap) Get(key string) (any, bool) {
    // Approximate: route to local-node shard.
    node := approximateLocalNode()
    return m.nodes[node].Get(key)
}
```

This works only if reads can be partitioned by node — for example, when a key's "home" node is determined by its hash. Cache lookups follow the standard hash; writes also go to the same node. The result: zero cross-NUMA traffic for most operations.

This is the pattern used by some of the most demanding in-memory key-value stores (Aerospike, ScyllaDB-style implementations in Go).

---

## Appendix W: Disaggregated Compute and CXL

A glimpse of the future. CXL (Compute Express Link) is an emerging interconnect that extends cache coherence across machines.

### What CXL changes

Today: a server's CPUs are coherent within the box. CPUs on different boxes communicate via network (not coherent).

CXL 3.0 (production around 2026): multiple machines can share a coherent memory pool. A cache line owned by machine A can be invalidated by machine B's write. Coherence traffic crosses the fabric.

### Implications for false sharing

False sharing across machines becomes possible. The cost: hundreds of microseconds per bounce (network latency).

If your data structure has false sharing on a CXL-shared cache line, throughput drops not by 10x but by 10000x. The same patterns (padding, sharding) apply but with much larger penalties for getting them wrong.

### Designing for CXL

When CXL becomes mainstream, the design questions for senior engineers include:

- Which data structures live in CXL memory vs local memory?
- How is coherence partitioned across machines?
- What padding is appropriate for CXL granularity (likely 256 bytes)?

This is speculative today (CXL is just being deployed), but worth knowing about. The principles of cache-aware design transfer; the magic numbers shift.

### What to do today

Build cache-aware designs at the box level. The skills will transfer to CXL when it arrives. Engineers who can pad and shard within a box will adapt to padding and sharding across boxes.

---

## Appendix X: Designing Custom Synchronization Primitives

At senior level you sometimes need to build sync primitives beyond what Go provides. Three examples.

### Custom 1: Padded RWMutex

```go
type PaddedRWMutex struct {
    sync.RWMutex
    _ [64 - unsafe.Sizeof(sync.RWMutex{})%64]byte
}
```

Use everywhere you would use `sync.RWMutex` in a slice or array. Drop-in replacement; the embedded type is fully usable.

### Custom 2: Per-CPU Mutex

A mutex that returns immediately if the calling goroutine is the only one on the current P.

```go
type PerCPUMutex struct {
    state [maxP]atomic.Int32 // per-P locked flag
    _pad  [cacheLine]byte
}

func (m *PerCPUMutex) Lock() {
    pid := runtime_procPin()
    if m.state[pid].CompareAndSwap(0, 1) {
        return // fast path: this P had no prior holder
    }
    // slow path: wait
    for !m.state[pid].CompareAndSwap(0, 1) {
        runtime.Gosched()
    }
}

func (m *PerCPUMutex) Unlock() {
    pid := getPID() // saved from Lock
    m.state[pid].Store(0)
    runtime_procUnpin()
}
```

Use case: protecting per-P state without a global lock. The mutex itself never bounces; each P touches only its own slot.

Limitation: if the goroutine is preempted between Lock and Unlock, the P may change. The simple implementation above assumes pinning; for preemptive usage you need a different design (e.g., a sync.Mutex per slot).

### Custom 3: Sharded WaitGroup

`sync.WaitGroup` uses one atomic counter. At scale, that counter false-shares with whatever is adjacent. A sharded version:

```go
type ShardedWaitGroup struct {
    shards [numShards]struct {
        v    atomic.Int64
        _pad [56]byte
    }
}

func (wg *ShardedWaitGroup) Add(delta int) {
    pid := runtime_procPin()
    wg.shards[pid%numShards].v.Add(int64(delta))
    runtime_procUnpin()
}

func (wg *ShardedWaitGroup) Done() {
    wg.Add(-1)
}

func (wg *ShardedWaitGroup) Wait() {
    for {
        var sum int64
        for i := range wg.shards {
            sum += wg.shards[i].v.Load()
        }
        if sum <= 0 {
            return
        }
        runtime.Gosched()
    }
}
```

Caveat: this is *not* semantically equivalent to `sync.WaitGroup`. Wait does not block; it spins (with Gosched). For workloads with millions of goroutines, this is faster than `sync.WaitGroup` despite the spin.

Not for general use. Specialty primitive for hot-path goroutine coordination.

---

## Appendix Y: Cost Models for System-Level Decisions

Senior engineers make decisions based on cost models, not just measurements. Let us build a more complete cost model.

### Variables

- W = writes per second per core.
- R = reads per second per core.
- N = number of cores writing.
- M = number of cores reading.
- C_write = cycles per coherence transition (M->I or M->S).
- C_read = cycles per coherence read (I->S or I->E).
- f = clock frequency.

### Padded vs unpadded

Padded (each writer has its own line):
- Per write: ~10 cycles (LOCK XADDQ on M line).
- Total throughput: N × W writes/sec × 10 cycles = 10NW cycles/sec.

Unpadded (shared line bouncing):
- Per write: 10 cycles + bounce cost.
- Bounce probability per write: (N-1)/N (any of the other writers had the line).
- Expected cost per write: 10 + (N-1)/N × C_write.
- Total: N × W × (10 + (N-1)/N × C_write).

The ratio is approximately C_write / 10 ≈ 10-30x for intra-socket.

### Read pressure adds to it

Reads cause E->S or M->S transitions when readers pull from a writing core. Each read on a shared line costs ~50-100 cycles (faster than a write bounce because no invalidate of other cores is needed, just downgrade).

Total cost model:
```
cycles/sec = N × W × (10 + (N-1)/N × C_write) + M × R × C_read
```

Comparison padded vs unpadded:

```
padded   = N × W × 10 + M × R × 10
unpadded = N × W × (10 + (N-1)/N × C_write) + M × R × C_read
```

For N=16, W=1e8, C_write=200, M=4, R=1e7, C_read=80:

```
padded   = 16 × 1e8 × 10 + 4 × 1e7 × 10 = 1.6e10 + 4e8 = ~1.6e10 cycles/sec
unpadded = 16 × 1e8 × (10 + 15/16 × 200) + 4 × 1e7 × 80 = 3e11 + 3.2e9 = ~3e11 cycles/sec
```

About 19x more cycles for unpadded. With 16 cores at 3 GHz = 4.8e10 cycles/sec capacity, padded uses 33% of CPU, unpadded would need 625% — i.e., the workload cannot fit.

This is a rigorous justification for padding: it is not a 19% speedup, it is the difference between workload fitting in the available cores or not.

### When the model says "don't pad"

If W is small (cold counter), the bounce cost is small in absolute terms:

For W=1000, N=16, C_write=200:
```
unpadded = 16 × 1000 × (10 + 15/16 × 200) ≈ 3e6 cycles/sec = 0.001% of CPU.
```

Padding here saves nothing meaningful. Don't pad.

The threshold for padding: W ≳ 10000/core/sec. Below that, padding is overkill.

### Multi-socket multiplier

Replace C_write with 1000-2000 cycles for cross-socket. Same math, 5-10x larger numbers. False sharing across sockets is catastrophic.

This is why single-process-per-NUMA is sometimes worth the architectural complexity.

---

## Appendix Z: Building a False-Sharing CI Pipeline

For high-throughput services, false-sharing prevention should be in CI. A senior engineer designs this pipeline.

### Component 1: Static analysis

A linter rule: any struct with multiple `atomic.*` fields must either be padded to 64 bytes or carry an explicit `//nopadding: justification` comment.

Implementation: a small Go program using `go/types` and `go/ast` to walk the AST and check struct definitions.

```go
// pseudo-code
for each struct definition:
    atomicFields := count fields whose type is in {atomic.Int32, atomic.Int64, atomic.Bool, ...}
    if atomicFields >= 2 and not has(_pad field) and not has nopadding comment:
        emit warning
```

This catches accidental adjacency early.

### Component 2: Size assertions

Generate `unsafe.Sizeof` tests for every padded struct:

```go
//go:generate genpadsize -input padded.go -output padded_size_test.go
```

A tool that reads the source, finds `_pad`-bearing structs, and generates corresponding tests:

```go
// generated
func TestSize_Counter(t *testing.T) {
    if got := unsafe.Sizeof(Counter{}); got%64 != 0 {
        t.Fatalf("Counter size %d not 64-aligned", got)
    }
}
```

A regression here means: someone added a field but did not update the pad. CI catches it.

### Component 3: Scaling benchmarks

A standardised benchmark format. Each hot package has `BenchmarkScale_*` benchmarks that run at GOMAXPROCS=1,2,4,8,16,32. CI runs these on every PR and posts a comment showing scaling curves.

```yaml
# .github/workflows/bench.yml (sketch)
- name: Run scaling benchmarks
  run: |
    go test -bench=BenchmarkScale -cpu=1,2,4,8 -count=3 ./... > bench.txt
    benchstat bench.txt
- name: Post comment
  run: ... # use gh CLI to post benchstat output
```

PRs that worsen scaling get flagged automatically.

### Component 4: Production sampling

A daily cron that runs `perf c2c` against a production canary host. Reports HITM counts over time. A spike is a regression worth investigating.

### Component 5: Cost-model dashboard

For each hot data structure in the codebase, compute the theoretical cost model (Appendix Y) given observed write rates. Show:
- Current padded cost (cycles/sec).
- Hypothetical unpadded cost.
- Ratio.

Engineers can see at a glance which structures benefit most from padding.

### Implementation effort

Building all five components is roughly a quarter of engineering work. Worth it for any company running Go at scale. The components run forever once built; they catch regressions for years.

---

## Appendix AA: A Year in the Life of a Senior Go Engineer Working on This

To make the senior level concrete, here is what a year of focused work on this topic might look like.

### Q1: Familiarity

- Read all four files (junior, middle, senior, professional).
- Run all benchmarks.
- Read `sync/pool.go` end-to-end.
- Identify one false-sharing site in the company codebase. Fix it.
- Run `perf c2c` on one production service. Document findings.

### Q2: Depth

- Read `runtime/sema.go`, `runtime/proc.go`, `runtime/mheap.go`.
- Build a custom sharded counter library. Open-source if appropriate.
- Mentor one junior engineer through the junior.md lab.
- Write an internal tech talk on false sharing.

### Q3: System architecture

- Design or redesign one high-throughput subsystem with cache-aware patterns from the start.
- Build at least one piece of CI infrastructure (size tests, scaling benchmarks).
- Read CockroachDB or Pebble source for patterns.
- Run perf c2c quarterly on production services.

### Q4: Mentoring and external work

- Mentor a second junior to senior level on a related topic (memory ordering, atomics).
- Contribute to an open-source Go project with cache-aware fixes.
- Write a blog post or conference talk.
- Identify one architectural-level change for the next year (e.g., per-NUMA process model).

A year of this work makes you a recognised expert in cache-aware Go. The skill compounds: every subsequent project benefits.

End of senior level.



