# The Memory Hierarchy — Interview Questions

> **Topic:** [The Memory Hierarchy](README.md)

---

## Introduction

These questions probe whether you can reason quantitatively about where data lives and what that costs — from approximate latencies through cache lines, associativity, the TLB, NUMA, and false sharing, up to profiling and data-layout design. Strong answers cite concrete numbers, name the mechanism, and connect it to a real fix.

## Table of Contents

- [Conceptual](#conceptual)
- [Tool-Specific](#tool-specific)
- [Tricky / Trap](#tricky--trap)
- [Design](#design)

---

## Conceptual

## Question 1

**Sketch the memory hierarchy with approximate latencies, and explain why it exists at all.**

Top to bottom: registers (<1 ns), L1 (~1 ns / ~4 cycles, ~32 KB), L2 (~4 ns, ~256 KB–1 MB), L3 (~12–40 ns, tens of MB, shared), DRAM (~60–100 ns, GBs), NVMe SSD (~10–100 µs), network/disk (~ms). Each level is bigger, cheaper per byte, and slower. It exists because no single memory technology is simultaneously fast, large, and cheap: SRAM is fast but tiny and expensive; DRAM is dense but ~100 ns; flash is cheap and huge but microseconds. Stacking them and keeping the active working set high in the pyramid yields *near-top-level speed at near-bottom-level cost* — provided access patterns have locality.

## Question 2

**What is a cache line and why does its size dominate so many performance results?**

A cache line is the fixed-size unit (typically 64 bytes) that moves between memory levels — you never transfer a single byte. Cost is therefore paid *per distinct line touched*, not per byte: reading 64 packed bytes costs about the same as reading one. This makes spatial locality decisive — sequential access uses every byte of each fetched line, while scattered access wastes most of each line, multiplying the number of lines (and misses) for the same logical data.

## Question 3

**Define spatial and temporal locality and explain how the cache exploits each.**

Temporal locality: a recently accessed address is likely to be accessed again soon — caches exploit it by *retaining* lines after use. Spatial locality: addresses near a recent access are likely next — caches exploit it by fetching a whole 64-byte line and by *prefetching* the following line(s). Real programs exhibit both, which is the entire reason caches work; code that destroys locality (pointer chasing, random hashing) leaves megabytes of cache idle.

## Question 4

**Explain the three types of cache misses and the fix for each.**

Compulsory (cold): first touch of a line — unavoidable except via prefetching or touching less unique data. Capacity: working set exceeds cache size, so reused lines are evicted before reuse — fix by shrinking the working set (blocking/tiling, smaller types). Conflict: the set *would* fit but too many hot lines map to the same set and evict each other — fix by changing stride/layout (avoid power-of-two strides, pad arrays). Naming the type tells you which lever to pull.

## Question 5

**What is the memory wall and what does it imply for software design?**

The memory wall is the long-running divergence between CPU speed (which grew fast) and DRAM *latency* (which barely improved — a few percent per year). A core can now execute hundreds of instructions in one ~100 ns DRAM access. Implications: caches/prefetchers are the only thing keeping CPUs busy; adding cores doesn't help memory-bound code (they all wait on DRAM); compute is effectively free relative to a miss, so recomputing or compressing to move fewer bytes often wins. Locality becomes the master performance variable.

## Question 6

**What is the TLB and how can it bottleneck a program whose data caches are fine?**

The TLB caches virtual→physical page translations so the CPU avoids a multi-level page-table walk on every access. It's small (tens to ~1500 entries); with 4 KB pages a few thousand entries cover only a few MB. A workload that spans many pages — large or page-sparse access — suffers TLB misses (page walks costing tens to hundreds of cycles) even with perfect data-cache behavior. Huge pages (2 MB) let one entry cover 512× more memory, often the fix.

## Question 7

**Distinguish latency from bandwidth and when each binds.**

Latency is the time for one access to return (~100 ns to DRAM); bandwidth is sustained bytes/second (tens of GB/s). Latency binds *dependent* accesses where you can't issue the next until the current returns (pointer chasing) — you pay full latency serialized. Bandwidth binds *independent* streaming where many accesses overlap. CPUs hide latency via memory-level parallelism (multiple in-flight misses), so sequential scans ride bandwidth while pointer chases expose latency.

---

## Tool-Specific

## Question 8

**Which perf counters do you check to diagnose a memory-bound loop, and how do you interpret them?**

`cache-misses`, `LLC-load-misses` (each ≈ a DRAM round trip), `L1-dcache-load-misses`, `dTLB-load-misses`, plus `cycles`/`instructions` for IPC. Low IPC (≪1) on a wide core signals stalls. Critically, convert misses to *time*: `LLC-load-misses × ~100 ns` and compare to runtime — a small miss *ratio* can still be the whole runtime. High `dtlb...walk_active` cycles → TLB-bound (huge pages). Sample with `perf record -e LLC-load-misses:pp` to locate the offending code.

## Question 9

**What does Top-Down Microarchitecture Analysis tell you that raw miss counts don't?**

TMA classifies every pipeline slot into Frontend-Bound, Bad-Speculation, Retiring, and Backend-Bound (which splits into Core-Bound and Memory-Bound, further into L1/L2/L3/DRAM-Bound). It tells you the *fraction of stalls actually caused by memory* — whether memory tuning will help at all. A loop that's 60% DRAM-Bound needs fewer bytes/better locality; one that's Core-Bound won't benefit from any cache work. It prevents optimizing the wrong layer. Run via `toplev` (pmu-tools) or VTune.

## Question 10

**How would you find false sharing in a poorly scaling parallel program?**

Use `perf c2c` (cache-to-cache), which records HITM events and reports the exact cache line being contended and the functions/PCs writing it. Symptom: a parallel section scales poorly or even slows past a few threads despite no logical data sharing. The report shows a single 64-byte line ping-ponging between cores. Fix: pad the independently-written data so each lands on its own line (`alignas(64)`, padding bytes, Java `@Contended`, Rust `CachePadded`).

---

## Tricky / Trap

## Question 11

**Two loops do the same additions over the same 2D array; one is 8× slower. Why?**

Loop order versus memory layout. A 2D array is stored row-major; the fast loop's inner index walks contiguous memory (every cache line fully used, hardware prefetch engaged), while the slow loop strides by a full row each step, touching one element per line and defeating prefetch. Same operations, same result — the difference is entirely cache-line utilization and prefetcher behavior, invisible in the source.

## Question 12

**A "2% cache miss rate" loop is the bottleneck. How is that possible?**

Because miss *ratio* is the wrong metric — convert to time. 2% of, say, 100 billion loads is 2 billion misses; at ~100 ns each that's ~200 seconds of pure DRAM stall. A low ratio over a huge load count can be the entire runtime. Always multiply miss *count* by miss *latency* and compare to wall-clock, never reason from the percentage alone.

## Question 13

**A linked list and an array hold the same 10M integers. Why is iterating the list ~100× slower?**

Each `node = node->next` is a dependency: the next address is unknown until the current line returns, so misses serialize and you pay full DRAM latency per node (~10M × ~100 ns ≈ 1 s) with no prefetch and no memory-level parallelism. The array scan generates independent, predictable accesses — prefetched, riding bandwidth, a few ms. Identical big-O, but the array's locality and access independence win by orders of magnitude.

## Question 14

**Your in-memory cache suddenly shows tens-of-ms p99 latency. The code didn't change. What happened?**

The working set likely outgrew RAM and the kernel started paging to swap (SSD) — the bottom of the hierarchy silently entered the hot path. A microsecond cache became a millisecond one. Confirm with `vmstat` swap-in/out (`si/so`) and memory pressure metrics. Fix: cap the cache below available RAM with admission/eviction; never allow the working set to cross the RAM→swap cliff. It's a hierarchy cliff, not a gradual slope.

---

## Design

## Question 15

**You're storing millions of particles processed by a SIMD physics loop. AoS or SoA, and why?**

SoA (separate contiguous arrays per field) for the field-at-a-time SIMD kernel: updating positions touches packed `x[]` and `vx[]` lines with every byte used and lets SIMD load 8–16 lanes per instruction — commonly 2–8× faster than AoS, where each line drags whole records (including unused fields) and strides defeat vectorization. If a different hot loop needs *whole* records, AoS or a hybrid AoSoA (tiles of N records) balances SIMD width against record locality. Match layout to the *dominant* access pattern.

## Question 16

**Design the memory-placement strategy for a high-throughput service on a 2-socket NUMA server.**

Make allocation NUMA-aware: rely on or control first-touch so pages land on the node of the thread that will use them — avoid the trap of one thread allocating+zeroing everything (all pages on one node) before a cross-socket pool processes it. Use parallel first-touch (each worker initializes the slice it later processes), pin threads and memory with `numactl`/affinity, and shard data per node. Verify with `numastat` (remote-access %) and uncore IMC counters. Ignoring this commonly costs 30–50% throughput; remote access runs ~1.5–2× the latency at reduced bandwidth.
