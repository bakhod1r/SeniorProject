# The Memory Hierarchy — Senior Level

> **Topic:** [The Memory Hierarchy](README.md)
> **Focus:** Design trade-offs across the hierarchy — data layout (AoS vs SoA), NUMA, false sharing, the memory wall — and how language and runtime choices change the cost model.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Core Concepts](#core-concepts)
  - [The memory wall](#the-memory-wall)
  - [Data layout is the lever: AoS vs SoA](#data-layout-is-the-lever-aos-vs-soa)
  - [Arrays vs linked structures, revisited](#arrays-vs-linked-structures-revisited)
  - [False sharing and the coherence tax](#false-sharing-and-the-coherence-tax)
  - [NUMA: when "RAM" has an address book](#numa-when-ram-has-an-address-book)
  - [Non-inclusive vs inclusive caches](#non-inclusive-vs-inclusive-caches)
- [Cross-Language Comparison](#cross-language-comparison)
- [Design Trade-Offs](#design-trade-offs)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

A senior engineer doesn't just write cache-friendly loops; they choose *data layouts and concurrency structures* whose interaction with the hierarchy is favorable by construction. That means understanding why the gap between CPU and memory keeps widening (the memory wall), why the same struct laid out two ways differs 5× in a SIMD loop, why two threads writing different variables can collide, and why a malloc on the "wrong" NUMA node silently halves your bandwidth. The hierarchy stops being a tuning afterthought and becomes an input to design.

---

## Prerequisites

- Middle tier: cache anatomy, the three Cs, prefetching, TLB, latency vs bandwidth.
- Working knowledge of at least two of C, Go, Java, Rust, and how each lays out aggregates in memory.
- Basic cache-coherence intuition (MESI-style: lines have shared/exclusive/modified states across cores).

---

## Core Concepts

### The memory wall

For decades CPU speed grew far faster than DRAM latency improved. Processors got ~50%+ faster per year through the 1990s; DRAM *latency* improved only a few percent per year (DRAM *bandwidth* and density grew fast, but the time for a single random access barely moved). The result, named the **memory wall**, is a structural divergence: a modern core can execute on the order of **hundreds of instructions in the time it takes one DRAM access to return** (~100 ns × several GHz).

Consequences that shape design:
- The cache hierarchy isn't an optimization; it's the **only** reason CPUs aren't permanently stalled. Caches and prefetchers exist to paper over the wall.
- Adding cores doesn't help a memory-bound workload — they all wait on the same DRAM. Many "parallel" speedups are really cache-locality speedups.
- Compute is effectively *free* relative to a miss. Recomputing a value can beat fetching a cached one; compression that trades CPU for fewer bytes moved often wins.

### Data layout is the lever: AoS vs SoA

The single highest-leverage decision is how you arrange records in memory.

**Array of Structures (AoS):** one contiguous record per element.
```c
struct Particle { float x, y, z, vx, vy, vz; int id; };
struct Particle ps[N];   // x,y,z,vx,vy,vz,id, x,y,z,...
```
**Structure of Arrays (SoA):** one contiguous array per field.
```c
struct Particles {
    float x[N], y[N], z[N];
    float vx[N], vy[N], vz[N];
    int id[N];
};
```

Now consider a loop that updates only positions from velocities (`x += vx`, etc.), ignoring `id`:

- **AoS:** each 64-byte line holds a whole particle including `id` and any padding. To touch `x` and `vx` you drag the entire record into cache — much of every line is unused for *this* loop. Worse, SIMD can't load 8 consecutive `x` values in one vector because they're strided by `sizeof(Particle)`.
- **SoA:** `x[0..15]` and `vx[0..15]` are each a packed cache line. Every byte fetched is used, and a SIMD unit loads 8/16 lanes in one instruction. Typical speedups for such kernels are **2–8×**.

The rule: **lay data out to match the access pattern of the hot loop, not the conceptual "object."** AoS reads well to humans and suits "process whole records"; SoA suits "process one field across all records" (the typical analytics/numeric/SIMD case). Hybrids — **AoSoA** (array of small SoA tiles, e.g. 8 records per tile) — balance SIMD width against record-locality and are common in physics engines and columnar databases.

### Arrays vs linked structures, revisited

Linked lists, trees of pointers, and hash tables with chained buckets all share a fatal property under the memory wall: **traversal is a dependency chain of cache misses.** Each `node = node->next` can't issue until the previous line returns, so you pay *full latency, serialized*, with no prefetch and no memory-level parallelism. For 10 million nodes scattered on the heap, that's ~10M × ~100 ns ≈ **1 second** just to walk the list — versus a few milliseconds to scan an equivalent array.

This is why modern high-performance structures favor **flattened, array-backed** designs: open-addressing hash maps (Swiss tables, Go's runtime maps, Rust's `hashbrown`) instead of chained ones; B-trees with wide nodes instead of binary trees; ring buffers instead of linked queues; and arena/slab allocators that pack nodes contiguously so even a "linked" structure has spatial locality. The data structure's *asymptotic* complexity is often beaten in practice by the one with better locality.

### False sharing and the coherence tax

Cache coherence operates at **cache-line granularity**, not variable granularity. If two threads on different cores write two *different* variables that happen to share one 64-byte line, every write invalidates the other core's copy of the line — the line ping-pongs between cores over the interconnect even though there's no logical sharing. This is **false sharing**, and it can turn a perfectly parallel loop into something *slower than single-threaded*.

```c
// BAD: counters[0] and counters[1] likely share a line.
long counters[NUM_THREADS];   // each thread does counters[tid]++

// GOOD: pad each counter to its own line.
struct alignas(64) PaddedCounter { long v; char pad[56]; };
PaddedCounter counters[NUM_THREADS];
```

Java has `@Contended` (with `-XX:-RestrictContended`), Go programmers pad structs to 64 bytes, Rust uses `#[repr(align(64))]` or `crossbeam`'s `CachePadded`. The fix is always the same idea: **give independently-written data separate cache lines.**

### NUMA: when "RAM" has an address book

On multi-socket servers (and many modern single-socket chiplet designs), memory is partitioned into **NUMA nodes**: each socket has its own memory controller and DRAM. Accessing **local** memory is fast (~100 ns); accessing a **remote** node's memory crosses the inter-socket link, costing roughly **1.5–2× the latency and a fraction of the bandwidth**.

The trap is allocation policy. Most OSes use **first-touch**: a page is physically placed on the node of the thread that *first writes* it — not the thread that `malloc`'d it. A common bug:

```c
// Thread 0 allocates AND initializes the whole array...
data = malloc(huge);
memset(data, 0, huge);          // all pages land on node 0
// ...then a thread pool on both sockets processes it -> half the threads are remote.
```

The fix is **parallel first-touch**: have each worker initialize the slice it will later process, so pages land local. Tools and APIs: `numactl`, `libnuma` (`numa_alloc_local`), `mbind`, and the `numastat` counters. Databases (PostgreSQL, large JVMs with `-XX:+UseNUMA`) and HPC codes treat NUMA placement as a first-class concern; ignoring it on a 2-socket box can cost **30–50%** of throughput.

### Non-inclusive vs inclusive caches

L3 may be **inclusive** (holds a superset of L1/L2 — simplifies coherence, but L3 capacity is partly "wasted" duplicating L2), **exclusive**, or **non-inclusive** (modern Intel server, AMD). This affects effective cache size and eviction behavior in ways that matter when you're squeezing the last 20%: on a non-inclusive design the *aggregate* cache is larger than L3 alone. You rarely code to this directly, but it explains why "my data fits in L3" predictions are fuzzy and why vendor microarchitecture details show up in benchmarks.

---

## Cross-Language Comparison

| Concern | C / C++ / Rust | Go | Java | Python |
|---|---|---|---|---|
| Struct layout control | Full; `alignas`, `#[repr(C)]`, packed | Good; struct field order, manual padding | Limited; JVM controls layout (Project Valhalla aims to add value types) | Almost none; objects are boxed |
| Arrays of values | Contiguous values by default | Slices of structs are contiguous | `T[]` of objects is an array of *references* (pointer chase!) | `list` is an array of references; use NumPy for contiguous |
| AoS→SoA refactor | Manual, fully expressible | Manual, expressible | Hard for object arrays; needs parallel arrays | Use NumPy/columnar libs |
| Locality default | Excellent | Good | Poor for object graphs, good for primitive arrays | Poor unless NumPy/Arrow |

The headline: **managed, reference-heavy languages put a pointer indirection between you and the cache.** A Java `Point[]` is an array of references to `Point` objects scattered on the heap — walking it is pointer chasing, not a contiguous scan. This is precisely why Java's Project Valhalla (value/primitive classes), Go's value semantics, and C#'s `struct` arrays exist: to let the programmer flatten objects into the cache. In Python, the only realistic path to hierarchy-friendly numeric code is NumPy/PyArrow, whose buffers *are* contiguous C arrays under the hood.

---

## Design Trade-Offs

- **SoA vs AoS** — SoA wins for field-at-a-time/SIMD; AoS wins for whole-record access and is more maintainable. AoSoA splits the difference at the cost of complexity.
- **Padding for false sharing vs memory waste** — 64-byte padding per hot counter costs RAM and cache footprint; only pad data that is *concurrently written* by different cores.
- **NUMA-local vs simple allocation** — NUMA-aware code is faster but couples allocation to a thread/topology, hurting portability and simplicity.
- **Flatten everything vs readable object graphs** — array-of-struct/columnar designs are faster but less natural; reserve them for the genuinely hot 5%.
- **Compute vs fetch** — under the memory wall, recomputing or decompressing can beat loading. Trade CPU for bytes-moved deliberately.

---

## Mental Models

- **The memory wall makes locality the master variable.** Most "scaling" and "optimization" wins are really locality wins wearing a disguise.
- **Coherence is line-granular; design data so independent writers don't share lines.** False sharing is a layout bug, not a logic bug.
- **"RAM" is not uniform.** On NUMA, *which* DRAM matters as much as *how much*. First-touch decides placement.
- **A pointer is a deferred cache miss.** Every indirection in a hot path is a potential serialized DRAM stall.

---

## Code Examples

### AoS vs SoA SIMD-friendliness (Go)

```go
// AoS: updating positions drags velocity+id through cache and blocks vectorization.
type Particle struct{ X, Y, Z, VX, VY, VZ float32; ID int32 }
ps := make([]Particle, N)
for i := range ps { ps[i].X += ps[i].VX } // strided X access

// SoA: X and VX are each contiguous -> vectorizable, every byte used.
type Particles struct{ X, Y, Z, VX, VY, VZ []float32; ID []int32 }
for i := range p.X { p.X[i] += p.VX[i] }   // pure streaming
```

### Eliminating false sharing (Go)

```go
type paddedCounter struct {
    v   uint64
    _   [56]byte // pad to a full 64B line
}
counters := make([]paddedCounter, runtime.NumCPU())
// counters[id].v++ from each goroutine -> no line ping-pong.
```

### NUMA-correct parallel first-touch (C / OpenMP)

```c
double *a = malloc(n * sizeof *a);
#pragma omp parallel for schedule(static)
for (size_t i = 0; i < n; i++)
    a[i] = 0.0;          // each thread first-touches its own slice -> local pages
// later: the SAME schedule processes a[] -> every access is node-local
```

---

## Best Practices

1. **Choose layout from the hot loop's access pattern.** SoA/AoSoA for field-wise/SIMD kernels; AoS for record-wise logic.
2. **Flatten pointer-heavy hot structures** into arrays/arenas; prefer open-addressing maps and wide B-trees over chained/binary structures.
3. **Pad concurrently-written data to cache lines**, and *only* that data, to kill false sharing without bloating everything.
4. **Make allocation NUMA-aware on multi-socket boxes** via parallel first-touch and the same partitioning for init and compute.
5. **In managed languages, prefer primitive arrays / value types / columnar buffers** over arrays of references in hot paths.
6. **Spend CPU to save memory traffic** when memory-bound: compress, recompute, pack.

---

## Edge Cases & Pitfalls

- **SoA hurting record-wise access.** If a later loop needs *whole* particles, SoA forces gathering six arrays — worse than AoS. Match layout to the *dominant* access.
- **False sharing hidden by the allocator.** Two heap allocations can land adjacent in one line; padding the *struct* doesn't help if the array element is the unit being shared — pad the element.
- **NUMA regressions from "helpful" copies.** A page migration, GC compaction, or a `realloc` can silently move pages to a remote node mid-run.
- **GC undermining layout.** A moving/compacting GC (Java, Go's is non-moving for now) can rearrange objects and break the locality you engineered; this is another reason flattened primitive arrays are safer.
- **Benchmarks that ignore the interconnect.** Single-socket tests miss NUMA effects entirely; a result that's great on a laptop can fall apart on a 2-socket production server.
- **Over-flattening.** Converting a cold, rarely-touched structure to SoA buys nothing and costs readability. Profile first; flatten the hot 5%.

---

## Summary

- The **memory wall** makes a DRAM miss cost hundreds of instructions, so **locality dominates** real performance and adding cores rarely fixes a memory-bound loop.
- **Data layout (AoS vs SoA vs AoSoA)** is the highest-leverage tuning knob; match it to the hot loop and you unlock SIMD and full line utilization for **2–8×**.
- **Pointer-linked structures are dependency chains of misses**; flattened, array-backed designs win in practice despite identical big-O.
- **False sharing** is a line-granular coherence bug fixed by padding concurrently-written data.
- **NUMA** makes RAM non-uniform; **first-touch** placement and parallel init keep accesses local, worth 30–50% on multi-socket hardware.
- **Managed languages insert pointer indirection**; reach for primitive arrays, value types, and columnar buffers to bring hot data back into the cache.
