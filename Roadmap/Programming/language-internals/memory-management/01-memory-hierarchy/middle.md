# The Memory Hierarchy — Middle Level

> **Topic:** [The Memory Hierarchy](README.md)
> **Focus:** The mechanisms behind the levels — cache lines, sets and associativity, miss types, prefetching, the TLB — and a working cost model you can reason with.

---

## Table of Contents

- [Introduction](#introduction)
- [Prerequisites](#prerequisites)
- [Glossary](#glossary)
- [Core Concepts](#core-concepts)
  - [Anatomy of a cache](#anatomy-of-a-cache)
  - [Associativity, sets, and eviction](#associativity-sets-and-eviction)
  - [The three Cs of cache misses](#the-three-cs-of-cache-misses)
  - [Spatial and temporal locality](#spatial-and-temporal-locality)
  - [Prefetching](#prefetching)
  - [The TLB and address translation](#the-tlb-and-address-translation)
  - [Bandwidth vs latency](#bandwidth-vs-latency)
- [A Cost Model You Can Use](#a-cost-model-you-can-use)
- [Mental Models](#mental-models)
- [Code Examples](#code-examples)
- [Coding Patterns](#coding-patterns)
- [Pros & Cons](#pros--cons)
- [Best Practices](#best-practices)
- [Edge Cases & Pitfalls](#edge-cases--pitfalls)
- [Summary](#summary)

---

## Introduction

At the junior level the hierarchy is a pyramid of latencies and one rule: be sequential. That rule works because of *machinery* — set-associative caches, hardware prefetchers, and a translation cache called the TLB — that you can now learn to reason about quantitatively. The goal of this tier is to replace "scattered access is slow" with a model that predicts *how* slow and *why*, so you can estimate the cost of a loop before you run it.

---

## Prerequisites

- The junior picture: levels, approximate latencies, the 64-byte cache line, locality.
- Comfort with hexadecimal and bitwise thinking (address bits split into fields).
- Basic idea of virtual memory: programs see virtual addresses; hardware maps them to physical RAM.

---

## Glossary

- **Cache line / block** — the unit of transfer and storage, typically 64 bytes.
- **Set** — a bucket of cache lines an address is allowed to live in.
- **Way / associativity** — how many lines fit in one set; an *N-way* cache has N candidate slots per set.
- **Tag** — the high address bits stored alongside a cached line to verify identity.
- **Eviction** — kicking out a line to make room; chosen by a replacement policy (pseudo-LRU).
- **Compulsory / capacity / conflict miss** — the three reasons a needed line isn't cached.
- **Prefetcher** — hardware (or compiler-inserted) logic that loads lines *before* they're demanded.
- **TLB (Translation Lookaside Buffer)** — a cache of virtual→physical page translations.
- **Page** — the unit of virtual memory mapping, usually 4 KB (or 2 MB/1 GB "huge pages").
- **Working set** — the distinct memory a program touches over a window of time.

---

## Core Concepts

### Anatomy of a cache

A cache splits every memory address into three fields:

```
| ----- tag ----- | -- set index -- | -- block offset -- |
        high bits      middle bits          low 6 bits (for 64B lines)
```

- **Block offset** (low 6 bits for a 64-byte line) picks the byte *within* the line.
- **Set index** picks which set the line maps to.
- **Tag** is stored with the cached line; on a lookup the hardware compares the address's tag against the tags in that set.

So a cache is essentially a hardware hash table: the set index is the hash bucket, and the tag is the key check. A **hit** is a tag match in the right set; a **miss** triggers a fetch from the next level.

### Associativity, sets, and eviction

- A **direct-mapped** cache has one line per set: each address has exactly one home. Simple and fast, but two hot addresses that map to the same set evict each other endlessly.
- A **fully associative** cache lets any line go anywhere: no conflicts, but checking every slot is expensive — used only for tiny caches like the TLB.
- Real L1/L2/L3 are **N-way set-associative** (commonly 8-way for L1/L2, 12–20-way for L3): a sweet spot. An address maps to one set; within that set, any of N ways may hold it.

When a set is full and a new line arrives, a **replacement policy** evicts one. Hardware can't afford true LRU across many ways, so it uses **pseudo-LRU** (tree-based bits) or similar approximations. The practical takeaway: recently used lines tend to survive, but it's not a guarantee.

### The three Cs of cache misses

Every miss is one of three kinds — a vocabulary that tells you *which fix applies*:

1. **Compulsory (cold) miss** — first-ever touch of a line. Unavoidable except by prefetching. Fix: prefetch, or touch less unique data.
2. **Capacity miss** — the working set is bigger than the cache, so lines you'll need again get evicted before reuse. Fix: shrink the working set (blocking/tiling, smaller types).
3. **Conflict miss** — the working set *would* fit, but too many hot lines map to the same set and evict each other. Fix: change layout/stride so addresses spread across sets (avoid power-of-two strides that alias).

A loop that strides by exactly a power of two (e.g. exactly 4096 bytes) is a classic conflict-miss generator: every access lands in the same handful of sets.

### Spatial and temporal locality

- **Temporal locality** — if you touched address A, you'll likely touch A again soon. Caches exploit this by *keeping* lines after first use.
- **Spatial locality** — if you touched A, you'll likely touch A+1, A+2… soon. Caches exploit this by fetching a *whole line* and by prefetching the *next* line.

Real programs have both, which is why caches work at all. Code that *destroys* locality — pointer chasing, random hashing into a huge table, column-major scans — gets little benefit from the megabytes of cache sitting idle.

### Prefetching

The CPU tries to hide latency by loading data before you ask:

- **Hardware prefetchers** detect simple patterns: sequential streams and constant strides. A forward `for` loop over an array is the easiest pattern to detect — the prefetcher races ahead, so demand loads frequently hit. This is *why* sequential access is fast beyond just line reuse.
- **Software prefetch** — explicit instructions (`__builtin_prefetch` in C/GCC, `_mm_prefetch`) tell the CPU "I'll need this address soon." Useful for irregular-but-predictable patterns (e.g. you can compute the next node's address before processing the current one). Easy to overuse: a wrong prefetch wastes bandwidth and pollutes cache.

Prefetchers struggle with: pointer chasing (the next address is unknown until the current line arrives), random access, and very short loops.

### The TLB and address translation

Programs use **virtual addresses**; the MMU translates them to physical RAM addresses using page tables. Walking the multi-level page table is itself several memory accesses — far too slow to do per load. So the CPU caches recent translations in the **TLB**.

- A **TLB hit** makes translation effectively free (overlapped with cache access).
- A **TLB miss** triggers a *page walk* (often hardware-driven), costing tens to hundreds of cycles — sometimes more than the data load it precedes.
- TLBs are small: on the order of **64–1500 entries**. With 4 KB pages, a few thousand entries cover only a few megabytes. A loop scanning gigabytes with poor page locality can be **TLB-bound** even when the data caches are fine.
- **Huge pages** (2 MB) let one TLB entry cover 512× more memory, dramatically cutting TLB misses for large working sets — a common production tuning knob for databases and JVMs.

The lesson: there are *two* caches you can miss — the data cache and the TLB — and they fail for different reasons.

### Bandwidth vs latency

These are independent axes and confusing them causes bad decisions:

- **Latency** = time for one access to come back (~100 ns to DRAM). It matters for *dependent* accesses, where you can't issue the next until the current returns (pointer chasing).
- **Bandwidth** = bytes per second the memory system can sustain (tens of GB/s per socket). It matters for *streaming*, where many independent accesses are in flight at once.

Modern CPUs hide latency by keeping **many outstanding misses** in flight (memory-level parallelism). A sequential scan saturates bandwidth and hides latency. A pointer chase exposes full latency on every step because each load depends on the previous — you get neither parallelism nor bandwidth.

---

## A Cost Model You Can Use

Estimate a loop's memory cost in three steps:

1. **Count distinct cache lines touched**, not bytes or operations. `n` floats scanned sequentially touch `n/16` lines (16 floats per 64-byte line).
2. **Classify the reuse.** Does the working set fit in L1 (~32 KB), L2 (~512 KB), or L3 (~tens of MB)? Pick the latency of the smallest level that *holds* it.
3. **Account for the access pattern.** Sequential → prefetched, near-best case. Strided/random → add full miss latency per line, and check whether you're also blowing the TLB.

Worked example: summing 64 million `int32` (256 MB).
- Lines touched ≈ 256 MB / 64 B = 4 million.
- 256 MB ≫ L3, so each line is a DRAM fetch the first time: ~capacity/compulsory miss territory.
- Sequential, so the prefetcher hides most latency and you run at **bandwidth limit** (~tens of GB/s) → a few milliseconds.
- Random access to the same data: each line exposes ~100 ns latency, ~4M × 100 ns ≈ **0.4 s** — about 100× slower. Same data, same total, different pattern.

---

## Mental Models

- **A cache is a hardware hash table** keyed by set index, with N slots per bucket and a tag check. Conflict misses are bucket collisions.
- **Two caches, two failure modes.** Data cache misses come from *touching too much or too scattered data*; TLB misses come from *spanning too many pages*. Huge pages fix the latter, not the former.
- **Latency is hidden by parallelism; pointer chasing kills parallelism.** Independent accesses overlap; dependent ones serialize.

---

## Code Examples

### Strided access reveals the cache line

```c
// Touch one int per stride. Larger stride => fewer useful bytes per line
// => more lines per element => slower, until the line is one-int-per-line.
for (size_t i = 0; i < N; i += stride)
    sum += a[i];
```

Plotting time vs `stride`, time rises until `stride` reaches 16 ints (one full 64-byte line per access) and then roughly plateaus — a direct measurement of the 64-byte line size from software.

### Software prefetch for a predictable irregular walk

```c
for (size_t i = 0; i < n; i++) {
    // Hint the line we'll need a few iterations ahead.
    __builtin_prefetch(&data[index[i + 8]], 0, 1);
    process(data[index[i]]);
}
```

This helps only when the future address (`index[i+8]`) is known well before it's needed — i.e. the index array itself is streamed predictably.

### Demonstrating the TLB in Go

```go
// Walking with a page-sized stride touches a new page every step:
// great data-cache behavior is irrelevant once you exhaust the TLB.
const pageStride = 4096 / 8 // 8-byte elements
for i := 0; i < len(buf); i += pageStride {
    sink += buf[i]
}
```

For a multi-GB `buf`, this is dominated by TLB misses, not data-cache misses — switching the allocation to huge pages can cut its time substantially.

---

## Coding Patterns

- **Loop interchange** — reorder nested loops so the innermost index walks contiguous memory (row-major inner loop over columns).
- **Loop blocking / tiling** — process the data in cache-sized tiles so a tile is fully reused before eviction; turns capacity misses into hits (classic in matrix multiply).
- **Avoid power-of-two strides and array dimensions** — pad arrays (e.g. `[N][N+1]`) to break the aliasing that causes conflict misses.
- **Batch independent work** — issue several independent loads so the CPU overlaps their latency instead of serializing.

---

## Pros & Cons

| Mechanism | Helps when | Hurts when |
|---|---|---|
| Set associativity | Reduces conflict misses vs direct-mapped | Costs power/area; not infinite |
| Hardware prefetch | Sequential/strided streams | Pointer chasing; pollutes cache on mispredict |
| Software prefetch | Predictable irregular access | Wrong distance wastes bandwidth |
| Huge pages | Large working sets (TLB pressure) | Fragmentation; wasted RAM if sparse |

---

## Best Practices

1. **Make the inner loop walk contiguous memory.** This single change wins more often than any micro-optimization.
2. **Size hot loops to a cache level deliberately** — tile big computations so each tile fits L1/L2.
3. **Watch for power-of-two aliasing** in array dimensions and strides; pad to dodge conflict misses.
4. **Treat the TLB as a separate budget.** For huge sequential or sparse-across-pages workloads, consider huge pages.
5. **Prefer streaming over chasing.** If you can express work as a scan of arrays rather than a walk of pointers, do it.

---

## Edge Cases & Pitfalls

- **The "fits in cache" cliff.** Performance is roughly flat while the working set fits a level, then drops sharply when it spills to the next. Microbenchmarks that stay under the cliff lie about production behavior.
- **Conflict misses with "small" data.** A 256 KB array that *should* fit L2 can thrash if your stride aliases sets. Capacity isn't the only constraint.
- **Prefetcher fooled by boundaries.** Hardware prefetchers usually don't cross page boundaries, so very page-fragmented access loses prefetch benefit even if sequential within pages.
- **Software prefetch as a crutch.** It rarely fixes a fundamentally pointer-chasing structure; redesigning the layout usually beats sprinkling prefetch hints.
- **Counting bytes, forgetting pages.** Two layouts with identical byte counts can differ wildly if one spans many more pages (TLB) or sets (conflicts).

---

## Summary

- A cache is a **set-associative hardware hash table** of 64-byte lines; addresses split into tag / set / offset.
- Misses come in three flavors — **compulsory, capacity, conflict** — and each points to a different fix.
- **Prefetching** hides latency for predictable patterns; **pointer chasing** defeats it.
- The **TLB** is a second cache you can miss; large or page-sparse workloads can be translation-bound, and huge pages help.
- **Latency vs bandwidth** are distinct: dependent accesses pay latency, independent streams ride bandwidth.
- Reason about loops by **counting distinct lines, identifying the holding cache level, and classifying the access pattern** — that model predicts the 10–100× differences you'll see in practice.
