---
layout: default
title: Professional
parent: LRU Concurrent
grand_parent: Concurrent Data Structures
ancestor: Go
nav_order: 5
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/21-concurrent-data-structures/02-lru-concurrent/professional/
---

# Concurrent LRU — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Information-Theoretic View of Caching](#information-theoretic-view-of-caching)
3. [Belady's Optimal Algorithm](#beladys-optimal-algorithm)
4. [Workload Characterization](#workload-characterization)
5. [Stack Distance and the Mattson Algorithm](#stack-distance-and-the-mattson-algorithm)
6. [The Mathematics of LRU](#the-mathematics-of-lru)
7. [TinyLFU: Formal Analysis](#tinylfu-formal-analysis)
8. [Count-Min Sketch Error Bounds](#count-min-sketch-error-bounds)
9. [Adaptive Algorithms: ARC's Adjustment Function](#adaptive-algorithms-arcs-adjustment-function)
10. [LIRS: Low Inter-reference Recency Set](#lirs-low-inter-reference-recency-set)
11. [S3-FIFO: A Closer Look at the Paper](#s3-fifo-a-closer-look-at-the-paper)
12. [Memory Hierarchy: Cache as the Outer Layer](#memory-hierarchy-cache-as-the-outer-layer)
13. [NUMA-Aware Sharding](#numa-aware-sharding)
14. [GC Pressure: A Quantitative Analysis](#gc-pressure-a-quantitative-analysis)
15. [Lock-Free Linked Lists](#lock-free-linked-lists)
16. [Persistent Memory and Caches](#persistent-memory-and-caches)
17. [Distributed Caching: CRDTs for Cache Coherence](#distributed-caching-crdts-for-cache-coherence)
18. [Cache as a Sliding Window](#cache-as-a-sliding-window)
19. [Information-Theoretic Lower Bounds](#information-theoretic-lower-bounds)
20. [The Page Replacement Literature](#the-page-replacement-literature)
21. [Profiling at Microarchitecture Level](#profiling-at-microarchitecture-level)
22. [Building a Cache for a Specific Workload](#building-a-cache-for-a-specific-workload)
23. [Production Stories at Scale](#production-stories-at-scale)
24. [Designing for 1B Ops/Day](#designing-for-1b-ops-day)
25. [Open Research Questions](#open-research-questions)
26. [Cheat Sheet](#cheat-sheet)
27. [Self-Assessment Checklist](#self-assessment-checklist)
28. [Summary](#summary)

---

## Introduction

The professional level is where caching becomes systems theory. We move from "use ristretto" to "understand why ristretto works." We derive hit-rate bounds from first principles. We read the original papers and reproduce the experiments. We design caches for workloads measured in billions of operations.

After reading this file you will:

- Understand cache theory from the information-theoretic perspective.
- Be able to derive expected hit rate from a workload's access distribution.
- Know the algorithms (Mattson, LIRS, ARC, TinyLFU, S3-FIFO) deeply enough to choose between them on principle.
- Be able to design and quantitatively analyze a cache for a novel workload.
- Recognize the open research questions in the field.

This is not a file you read once. It is a reference for the rest of your career.

---

## Information-Theoretic View of Caching

A cache is a *compression* of an access trace: it remembers which keys "matter" and forgets the rest. The compression ratio (cache size / unique keys) and the access distribution (Zipf, uniform, etc.) determine the achievable hit rate.

### The hit-rate-capacity curve

For a workload with `N` unique keys accessed with probabilities `p_1, p_2, ..., p_N` (in descending order), the optimal cache of size `C` holds keys `1..C`. Hit rate is:

```
H_opt(C) = Σ_{i=1}^{C} p_i
```

For a Zipf distribution with parameter `s`:

```
p_i ∝ 1 / i^s
H_opt(C) ≈ (C/N)^(1-1/s)   for large N, s > 1
```

For `s = 1` (true Zipf), the curve has a slow log decay. For `s = 0.5` it is sub-linear. For `s = 2` it is steep.

### Empirical Zipf parameters

Real-world workloads:

- **Web requests by URL**: `s ≈ 0.8-1.2`. Moderate skew.
- **Database queries by table**: `s ≈ 1.5-2.0`. Strong skew.
- **User IDs in a social network**: `s ≈ 1.0`. Classic Zipf.
- **Search queries**: `s ≈ 0.7`. Long tail.

Knowing `s` for your workload tells you the achievable hit rate at any capacity.

### Information bound

A cache of `C` keys stores at most `C log₂(N)` bits of "which keys are valuable" information. This bounds how much you can learn from the access history. Real caches (LRU, LFU) achieve a fraction of this bound; TinyLFU and Belady get closer.

---

## Belady's Optimal Algorithm

Belady's MIN (1966) is the offline optimal: evict the entry whose next access is furthest in the future.

### Why it works

- Every entry that will not be accessed soon is "more evictable" than one that will be accessed soon.
- The optimal choice is the one whose absence costs the longest waiting time.

### Why it cannot be implemented online

You need to see the future. Even with a one-step lookahead, the algorithm is not optimal.

### Why it matters anyway

Belady's gives a **lower bound on miss rate** that any online algorithm must achieve to be optimal. Comparing your cache's miss rate to Belady's tells you how much room there is for improvement.

For typical workloads:

- LRU achieves ~120% of Belady's miss rate (i.e., LRU's miss rate is 1.2x optimal).
- ARC: ~110%.
- W-TinyLFU: ~105%.
- LIRS: ~105-110%.

The remaining 5% is the inherent cost of being online.

### Computing Belady's offline

```go
func BeladysMiss(trace []int, capacity int) int {
    nextAccess := make(map[int]int)
    cache := make(map[int]bool)
    misses := 0
    for i, k := range trace {
        if cache[k] {
            continue
        }
        misses++
        if len(cache) >= capacity {
            // evict the one with the farthest next access
            farthest := -1
            victim := 0
            for ck := range cache {
                next := nextOccurrence(trace, i, ck)
                if next > farthest {
                    farthest = next
                    victim = ck
                }
            }
            delete(cache, victim)
        }
        cache[k] = true
    }
    return misses
}
```

O(n²) naive. Better implementations use a priority queue keyed by next-access-time. Real benchmarks pre-compute next-access lookups.

---

## Workload Characterization

Before choosing an algorithm, characterize the workload along several axes:

### Skew

How much traffic concentrates on hot keys? Plot popularity rank vs frequency on log-log. The slope is the Zipf parameter.

### Temporal locality

Do recently accessed keys tend to be re-accessed soon? Plot inter-access time distribution. Heavy left tail = strong temporal locality.

### Spatial locality

Are sequential keys often accessed together? Plot key-distance distribution between consecutive accesses. Concentrated near zero = spatial locality.

### Working set size

How many distinct keys are accessed in a window? Plot working set vs window size. Plateaus when working set is bounded.

### Burst pattern

Are there hot phases and cold phases? Compute autocorrelation of access rate.

### Read/write ratio

Track Get vs Set. Read-heavy → cache helps. Write-heavy → cache pollution.

### Key entropy

How predictable is the next key? High entropy = harder to cache.

Each characteristic suggests a policy:

- High skew, stable: LFU or W-TinyLFU.
- Strong temporal locality: LRU.
- Spatial locality: prefetch ahead.
- Bursty: ARC.
- High write rate: write-back or no cache.

---

## Stack Distance and the Mattson Algorithm

Stack distance is the position of a key in the LRU stack at its time of access. If a key was just accessed (top of stack), its stack distance is 1. If it was accessed 5 keys ago and 5 unique keys have been accessed since, stack distance is 5.

### Why stack distance matters

The hit rate of an LRU cache of size `C` is the fraction of accesses with stack distance `≤ C`. This is Mattson's algorithm (1970).

### Computing stack distance

```go
func StackDistances(trace []int) []int {
    seen := make(map[int]int) // key -> last seen index
    distances := make([]int, len(trace))
    for i, k := range trace {
        if last, ok := seen[k]; ok {
            distances[i] = countDistinctBetween(trace, last+1, i)
        } else {
            distances[i] = -1 // first occurrence
        }
        seen[k] = i
    }
    return distances
}
```

The hit rate for an LRU of size `C` is `|{i : 0 < d_i ≤ C}| / N`.

### What this gives you

A single trace, processed once, tells you LRU's hit rate at every capacity. Plot it:

```
hit rate
  100% │
       │       _____ asymptote
       │     /
       │    /
       │   /
       │  /
       │ /
       │/
    0% └─────────────────────► cache size (log)
```

The curve's shape predicts how much capacity buys you. If it is steep, more capacity helps a lot. If it is flat, you have a working-set bound.

This is the *Miss Ratio Curve* (MRC). Production teams compute MRCs nightly to tune cache sizes.

---

## The Mathematics of LRU

### Reuse distance

Reuse distance is the number of *distinct* keys accessed between two consecutive accesses of the same key. LRU hit iff reuse distance ≤ C.

For a workload with reuse-distance distribution `P(d)`, LRU hit rate at capacity `C`:

```
H_LRU(C) = Σ_{d=1}^{C} P(d)
```

This is exactly what Mattson's algorithm computes.

### IRM model

The Independent Reference Model: each access independently picks key `i` with probability `p_i`. Under IRM, LRU hit rate has a closed form:

```
H_LRU(C) ≈ 1 - exp(-Σ p_i × (1 - e^(-p_i × C/N)))
```

(Approximation; the exact form involves a complex sum.)

This model is bad for real workloads (no temporal locality) but useful as a baseline.

### Working-set theorem

For workloads with a stable working set of size `W`, any cache of capacity `≥ W` achieves near-100% hit rate. Below `W`, hit rate drops sharply. The "knee" of the MRC at `W` is the operational sweet spot.

---

## TinyLFU: Formal Analysis

TinyLFU admits a candidate iff its estimated frequency exceeds the victim's. Formal claim: TinyLFU + LRU is close to Belady's optimal for stationary workloads.

### Why it works

For a stationary workload, the keys you should keep are those most likely to be accessed next — i.e., the most frequent. TinyLFU's frequency sketch tracks this. Admission filters out one-time keys; eviction selects from already-admitted candidates.

### When it fails

- **Non-stationary**: a key that was hot last hour but cold now still has high frequency. The aging mechanism (halving) compensates partially but lags.
- **Bimodal**: two workloads with different patterns interleaved. The sketch averages them. Separate caches per workload.
- **Very small caches**: the sketch overhead becomes proportional to the cache. For caches with <1000 entries, plain LRU is more efficient.

### Empirical hit-rate improvements

vs LRU, on real traces (from the TinyLFU paper):

- DS1: +10% to +15% absolute hit rate.
- F2: +15% to +25%.
- OLTP: +5% to +10%.
- WebSearch1: +20% to +30%.

These are substantial. Adopting TinyLFU is often worth the complexity.

---

## Count-Min Sketch Error Bounds

A CMS with `d` rows of `w` counters has additive error bound:

```
P(error ≥ ε × N) ≤ exp(-d) for ε = e / w
```

Where `N` is total stream size. For ristretto's `d = 4`, `w = 1M`:

```
ε = e / 10^6 ≈ 2.72 × 10^-6
P(error ≥ ε × N) ≤ exp(-4) ≈ 1.83%
```

For `N = 10^9` operations:

```
error ≤ 2.72 × 10^3 = 2720
```

With probability 98.17%, the estimated count for any key is within 2720 of the true count. For ranking decisions (is key A hotter than key B?), this is more than sufficient as long as the gap between candidates is >2720.

### Saturating counters

ristretto's 4-bit counters saturate at 15. After saturation, increments are silent. The error analysis above breaks down — a key may have true count 1000 but stored count 15. This is acceptable because:

1. The threshold for admission is small (typically 1).
2. Keys at saturation are all "very popular"; ordering among them does not matter.
3. The halving on aging eventually brings them back below saturation.

---

## Adaptive Algorithms: ARC's Adjustment Function

ARC maintains a parameter `p` that controls the size of the recency-favored half (T1) vs the frequency-favored half (T2):

```
T1 size = p
T2 size = C - p
```

Adjustment rules:

- A hit in B1 (ghost of T1) suggests T1 was too small. Increment `p`.
- A hit in B2 (ghost of T2) suggests T2 was too small. Decrement `p`.

The increment/decrement step size is:

```
δ_1 = max(|B2|/|B1|, 1) when hit in B1
δ_2 = max(|B1|/|B2|, 1) when hit in B2
```

This ratio-based adjustment converges to the optimal `p` for the current workload. As workload shifts, `p` adapts.

### Why ARC is patented

The specific adjustment function is novel and IBM patented it. Workaround implementations (like `hashicorp/golang-lru`) use a simpler rule that achieves most of the benefit without infringing.

---

## LIRS: Low Inter-reference Recency Set

LIRS (Jiang & Zhang 2002) tracks Inter-Reference Recency (IRR) — the number of distinct keys between two consecutive accesses of the same key.

### Key insight

If a key's IRR is small, it is "hot." LIRS keeps the K smallest-IRR keys in a "LIR" set; the rest in a "HIR" set. The LIR set is the protected core.

### Implementation

A stack tracks all recently-accessed keys. The bottom-most LIR key in the stack defines the recency threshold. Keys with smaller IRR are LIR; larger are HIR.

LIRS handles many workloads where LRU fails. On scan workloads, the scan keys never become LIR (their IRR is huge) so they don't displace the hot set.

### Performance

Comparable to ARC on most workloads. Simpler in some respects (no adjustment function). Used by MySQL's buffer pool.

---

## S3-FIFO: A Closer Look at the Paper

The S3-FIFO paper (FAST 2024) makes a striking claim: three FIFO queues outperform LRU and W-TinyLFU on most real workloads.

### The algorithm

- **Small queue (S)**: 10% of capacity, FIFO.
- **Main queue (M)**: 90% of capacity, FIFO.
- **Ghost queue (G)**: tracks keys recently evicted from M.

Rules:

1. New key inserted → S.
2. Hit on a key: increment its access counter (0-3, saturating). No queue movement.
3. S evicts oldest:
   - If counter ≥ 1 → move to M.
   - Else if key in G → ignore.
   - Else → add to G.
4. M evicts oldest:
   - If counter ≥ 1 → reinsert at back of M with counter reset.
   - Else → drop (also add to G).

### Why it works

- **FIFO is fast**: no MoveToFront, just append/pop. Lock-friendly.
- **Counter records popularity**: similar to TinyLFU but per-entry, much smaller.
- **Ghost queue prevents oscillation**: a hot key briefly evicted from M re-enters M directly on next access.

### Empirical results

The paper compares on 6,222 production traces (Twitter, Microsoft, etc.):

- S3-FIFO: best hit rate on 78% of traces.
- W-TinyLFU: best on 15%.
- ARC: best on 4%.
- LRU: best on 3% (small capacity, simple workloads).

### Go implementations

As of mid-2026, several open-source implementations exist but none has reached `hashicorp/golang-lru`-level adoption. Expect this to change as S3-FIFO becomes the new "modern default."

---

## Memory Hierarchy: Cache as the Outer Layer

The CPU's L1/L2/L3 caches use the same principles as software caches. Both are bounded fast stores in front of a slower source.

Differences:

- **L1/L2/L3 are hardware-managed**, with simple LRU-like policies.
- **L1 is per-core**, 32 KB, 4-cycle latency.
- **L2 is per-core**, 256 KB, 12-cycle latency.
- **L3 is shared**, 8-32 MB, 40-cycle latency.
- **Software cache** is heap-resident, often >100 MB, ~100 ns access.

The software cache is one more level in the hierarchy: between L3 and main memory (for data already in process) or between memory and disk/network (for data from external sources).

Caches at every level use the same playbook: identify hot data, hold it close, evict when capacity is reached. The implementations differ but the theory is shared.

---

## NUMA-Aware Sharding

On multi-socket machines, each socket has local memory. Cross-socket access is 2-5x slower.

### Detection in Go

Go does not expose NUMA directly. Use cgo or syscalls:

```go
//#include <numa.h>
//#cgo LDFLAGS: -lnuma
import "C"

func numaNode() int {
    return int(C.numa_node_of_cpu(C.sched_getcpu()))
}
```

### Strategy 1: pin process to one node

```bash
numactl --cpunodebind=0 --membind=0 ./service
```

Simple, predictable. Half the resources of the box, but no cross-socket traffic.

### Strategy 2: per-node shards

Each NUMA node has its own subset of cache shards. Each goroutine routes to a shard on its current NUMA node.

```go
type NUMACache struct {
    perNode [][]*shard
}

func (c *NUMACache) pick(k string) *shard {
    node := numaNode()
    shards := c.perNode[node]
    idx := hash(k) % uint64(len(shards))
    return shards[idx]
}
```

Drawback: a key may live in multiple nodes' caches (one per node). Effective capacity is divided.

### Strategy 3: locality routing

The first access of a key picks a node; subsequent accesses for the same key always go to that node (consistent hashing or sticky session). Each key lives on exactly one node.

### When NUMA matters

- 2+ socket machines.
- Cache-bound workload (cache is a CPU hotspot).
- High concurrency (many cores).

For most cloud workloads (single-socket VMs), NUMA is irrelevant.

---

## GC Pressure: A Quantitative Analysis

Each Add on an on-heap LRU allocates:

- `*entry[K,V]`: ~48 bytes (key, value, padding).
- `*list.Element`: ~56 bytes (Value, prev, next, list pointer).

Total: ~104 bytes per Add. At 10M Add/sec:

```
allocation rate = 10M × 104 = 1.04 GB/sec
```

The Go GC scans the heap when allocations reach a threshold (default 100% growth). Steady-state heap size determines GC frequency.

If your cache holds 100M entries × 104 bytes = 10.4 GB, the GC needs to scan 10.4 GB on each cycle. Scan time is ~10 ms/GB for pointer-heavy heaps → 104 ms pause every few seconds.

### Mitigation 1: shrink per-entry overhead

Use a custom data structure that combines key, value, and list pointers into one struct. Saves ~50 bytes per entry.

### Mitigation 2: pre-allocate

A pre-allocated slice of `entry` structs has only one heap object regardless of capacity. The GC scans the slice once, not N times.

### Mitigation 3: off-heap

Move values to an unmanaged byte arena. The Go GC ignores it entirely.

### Mitigation 4: shrink working set

If you can keep the cache to <100 MB, GC overhead is negligible regardless of design.

The breakeven point for off-heap: when GC overhead exceeds the serialization cost. For pointer-heavy values, typically at ~1 GB cache size.

---

## Lock-Free Linked Lists

A linked list that allows concurrent insert, remove, and traversal without locks. The classic algorithm is the Harris/Michael lock-free linked list.

### High-level idea

- Nodes have a `next` pointer that includes a "marked" bit.
- To delete a node, atomically set the marked bit on its `next` pointer.
- Subsequent traversals skip marked nodes and physically remove them via CAS.

### Why it is hard

- ABA problem: a node may be removed and re-inserted between two reads of its pointer. Requires hazard pointers or epoch-based reclamation.
- Memory reclamation: when can a removed node be freed? Some thread may hold a pointer to it.
- Visibility: writes by one thread must be visible to others; requires careful use of atomics.

### Go's approach

Go's `sync/atomic` provides the primitives. A lock-free linked list in Go is ~200 lines, carefully tested. Most authors do not implement one; they use sharded mutexed lists instead.

### Why caches rarely use them

- Sharded mutex lists are simpler and perform similarly at typical contention levels.
- Lock-free reclamation is complex (requires hazard pointers or epoch GC, which Go does not provide directly).
- The win is marginal for cache workloads (mostly point operations, not full traversals).

For a cache, the BP-Wrapper buffered approach is usually preferable.

---

## Persistent Memory and Caches

Intel Optane (and successors) offer persistent memory: byte-addressable like RAM, but persistent across reboots. Caches in persistent memory survive process restarts.

### Use cases

- **Page cache** for databases: warm restart possible.
- **Session caches** for stateful services: failover without re-warming.
- **Distributed cache** with local persistence: tolerate network partitions.

### Limitations

- **Slower than DRAM**: ~300 ns vs ~80 ns.
- **Smaller capacity**: ~3 TB max vs ~24 TB for DRAM.
- **Expensive**: more per GB than DRAM until recently.
- **Cache flushing**: persisting requires explicit flushes; bugs cause data loss.

As of 2026, persistent memory has been deprecated by Intel; the technology survives in other forms (CXL memory, MRAM). The principles still apply.

---

## Distributed Caching: CRDTs for Cache Coherence

Conflict-Free Replicated Data Types (CRDTs) let multiple replicas converge without coordination. Caches can use CRDTs to handle conflicting updates.

### Last-write-wins

Each cache entry has a timestamp. On conflict, the later write wins. Simple, requires synchronized clocks.

### Vector clocks

Each entry has a per-replica counter. Detects concurrent writes. Lets the application resolve.

### G-counters

Grow-only counters. Each replica increments its own counter; the merged value is the sum. Useful for cache statistics (hit count, eviction count).

### Practical use

Most distributed caches (Redis Cluster, Memcached) do not use CRDTs. They use shard-and-route (each key lives on one node) plus failover. CRDTs are for genuinely multi-master systems, which most in-process caches are not.

---

## Cache as a Sliding Window

A cache of size `C` is approximately a sliding window over the last `C` distinct keys. For a uniform workload, LRU holds the last `C` distinct accesses. For a skewed workload, it holds the `C` most-recently-touched keys, weighted toward popular ones.

### Connection to streaming

Streaming algorithms (count-min sketch, HyperLogLog, etc.) operate on infinite streams with bounded memory. A cache is the same: a stream of accesses, bounded memory, deciding which to keep. Caching is a special case of streaming approximation.

### Hot-cold separation

A cache implicitly classifies keys into hot (in cache) and cold (not in cache). This binary classification is information-poor; W-TinyLFU enriches it with a frequency estimate (continuous, more information).

The future of caching may move further: each key has a learned utility score, eviction picks the lowest-utility entry. Machine-learned caching (eg. Microsoft's RL-based caches) is an active research area.

---

## Information-Theoretic Lower Bounds

Given a workload's access distribution `p_i`, the entropy is:

```
H = -Σ p_i log₂(p_i)
```

A cache of size `C` can hold at most `C log₂(N)` bits of information. The hit rate is bounded by how much of the access trace this information can predict.

For a Zipf workload with `s = 1`, the entropy grows as `O(log N)`. A cache of `O(1)` keys captures a meaningful fraction. This explains why caches work so well on skewed workloads.

For a uniform workload, the entropy is `log₂(N)` (maximum). No cache smaller than `N` does better than random.

The takeaway: the *theoretical maximum* hit rate is workload-dependent. No amount of clever algorithms beats the information-theoretic bound.

---

## The Page Replacement Literature

Caching is the in-memory analog of virtual memory page replacement, where the OS picks pages to swap to disk. The literature dates back to the 1960s:

- **Belady 1966**: Optimal algorithm (offline).
- **Belady 1969**: Belady's Anomaly (some workloads, more capacity → more misses with FIFO).
- **Mattson et al. 1970**: Stack distance and MRC.
- **Aho et al. 1971**: Theory of online algorithms.
- **Megiddo & Modha 2003**: ARC.
- **Jiang & Zhang 2002**: LIRS.
- **Einziger, Friedman, Manes 2017**: TinyLFU.
- **Yang et al. 2024**: S3-FIFO.

Reading the originals is illuminating. Most are short (10-30 pages) and well-written.

---

## Profiling at Microarchitecture Level

Beyond CPU profiles, microarchitecture profiling exposes cache, branch, and pipeline behavior.

### Linux perf

```bash
perf stat -e cache-misses,cache-references,branch-misses,branches ./service
```

Reports:

- Cache hit rate (CPU caches, not software).
- Branch prediction accuracy.

### Intel VTune

Closed-source but very detailed. Identifies:

- L1/L2/L3 misses by code location.
- TLB misses.
- Frontend stalls.
- Backend stalls.

For caches:

- High L1 miss rate on Get → linked list nodes spread across heap → arena.
- High TLB miss rate → huge cache → hugepages.
- Frontend stall → too much branching → simplify.

### eBPF for production

Tools like `bcc` and `bpftrace` can profile live services without restart. Useful for runtime metrics that pprof cannot capture.

---

## Building a Cache for a Specific Workload

### Step 1: characterize

Collect a sample trace (1M+ accesses). Compute:

- Unique keys.
- Access distribution (Zipf parameter).
- Reuse distance distribution.
- Working set size at various windows.

### Step 2: simulate

Run the trace through several candidate policies (LRU, 2Q, ARC, W-TinyLFU, S3-FIFO) at varying capacities. Plot MRCs.

### Step 3: choose

Pick the policy that achieves the target hit rate at the lowest capacity (= lowest memory cost).

### Step 4: implement

Use an existing library if possible. Customize if necessary.

### Step 5: deploy

Behind a flag. Compare with the existing cache.

### Step 6: tune

Adjust capacity, TTL, shard count based on production metrics.

This process takes 1-3 weeks for a serious cache deployment. The result is a cache with measured benefits.

---

## Production Stories at Scale

### Story: Twitter's caching layer

Twitter operates several cache tiers serving billions of requests per day. Their LRU+TTL caches are sharded by user ID and replicated across data centers. Hit rates are 95%+ on most tiers.

Key insights from their published work:

- The 90% hit rate target is easy; 99% is hard.
- Tail latency matters more than mean. A 10% miss rate at 100 ms is worse than 20% at 50 ms.
- Cache topology evolves with traffic patterns.

### Story: Facebook's TAO

TAO is Facebook's distributed graph cache. It serves the social graph (users, friendships, posts). Hit rate is 99.8%; the cache layer dwarfs the database in capacity and throughput.

Insights:

- Read-after-write consistency matters.
- Geo-replication is essential for global services.
- Cache invalidation is the hardest problem; TAO uses both versioned writes and pub/sub.

### Story: Google's Borg/Caffeine

Google internally uses Caffeine (Java W-TinyLFU implementation) for many services. The decision was based on benchmarks showing 5-10% hit rate improvement over plain LRU.

Insights:

- 5% hit rate matters at Google's scale.
- The complexity tradeoff is acceptable when measured benefits exceed engineering cost.

---

## Designing for 1B Ops/Day

A service doing 1B ops/day = 11.5K ops/sec average. With 5x peak factor: ~58K ops/sec peak. Modest.

The interesting design challenges appear at:

- **100K ops/sec sustained**: sharding becomes necessary.
- **1M ops/sec sustained**: ristretto or equivalent.
- **10M ops/sec sustained**: custom design, off-heap, NUMA tuning.

For 1B ops/day:

- Single sharded LRU per pod is sufficient.
- 16-32 shards.
- 8-16 GB heap budget per pod.
- 10-pod fleet → 100 GB total cache (per data center).

Per-pod cache covers 99% of the traffic. The remaining 1% goes to Redis (L3). The DB is rarely touched.

This is a *normal* scale. Bigger services (Google, Facebook, Twitter scale) have more layers, more sophistication, more failure modes. But the principles are the same.

---

## Open Research Questions

A few areas where caching is still evolving:

- **Machine-learned eviction**: can a small neural net beat W-TinyLFU? Microsoft's research suggests yes for some workloads.
- **Persistent caches**: how to integrate with cloud storage tiers.
- **Hardware acceleration**: dedicated cache chips (Pliops, ScaleFlux) offload caching to FPGA.
- **Adversarial caches**: how to design caches resistant to malicious traffic (other than poisoning defenses we have).
- **Multi-tenant caches**: how to fairly share a single cache among tenants with different access patterns.
- **Workload prediction**: forecast which keys will be hot and prefetch.

If you are looking for a research problem, any of these are open.

---

## Cheat Sheet

```text
THEORY:
  Belady    = optimal (offline)
  LRU       = recency
  LFU       = frequency
  ARC       = LRU + LFU adaptive
  LIRS      = inter-reference recency
  W-TinyLFU = window + TinyLFU + SLRU (ristretto)
  S3-FIFO   = three FIFOs (state of the art 2024)

ANALYSIS TOOLS:
  Mattson algorithm:    compute MRC from a trace
  Stack distance:       LRU's key analytical quantity
  Reuse distance:       inter-arrival distinct count
  Working set size:     #distinct keys in a window

PERFORMANCE LEVERS:
  Sharding:             scales contention
  BP-Wrapper:           lock-free reads
  Count-Min Sketch:     compressed frequency
  Cost-based capacity:  bound bytes, not items
  Off-heap arenas:      avoid GC

OPS:
  MRC nightly:          tune capacity
  Per-prefix hit rate:  detect per-route problems
  Mutex profile:        detect contention
  GC trace:             detect pressure
  Working-set tracker:  size for the workload
```

---

## Self-Assessment Checklist

- [ ] I can derive the hit rate of an LRU at capacity C from a workload's stack-distance distribution.
- [ ] I can read the original TinyLFU paper and reproduce its results on a sample trace.
- [ ] I can quantify GC overhead for a given cache configuration.
- [ ] I can design a cache for a workload measured in billions of ops.
- [ ] I can explain why S3-FIFO outperforms W-TinyLFU on most production traces.
- [ ] I understand the patent situation around ARC.
- [ ] I can implement Belady's algorithm and use it to bound my cache's optimality gap.
- [ ] I can write a lock-free producer-consumer ring buffer in Go from scratch.
- [ ] I can profile microarchitecture-level cache misses in a Go service.
- [ ] I can choose between consistent hashing, NUMA-aware sharding, and sticky routing based on workload characteristics.

---

## Detailed walkthrough: the Mattson algorithm in code

The Mattson algorithm (1970) computes the hit-rate curve of an LRU at all capacities from a single pass through a trace. The output is the MRC: hit rate vs cache size.

### The algorithm

For each access:

1. Look up the key in a structure tracking its current LRU position (stack distance).
2. If found at distance d, record d (this access would hit any LRU of size >= d).
3. Update positions: bring this key to the top (distance 1), push all others down by 1.

Naively this is O(n) per access for n unique keys. With balanced trees or skip lists it is O(log n).

### Implementation in Go

```go
package mattson

import "github.com/wangjia184/sortedset"

type Mattson struct {
    set      *sortedset.SortedSet // ordered by recency
    counter  int64
}

func New() *Mattson {
    return &Mattson{set: sortedset.New()}
}

// Access returns the stack distance of key. -1 for first occurrence.
func (m *Mattson) Access(key string) int {
    m.counter++
    if node := m.set.GetByKey(key); node != nil {
        // Compute distance from rank.
        rank := m.set.FindRank(key)
        distance := m.set.GetCount() - rank + 1
        m.set.AddOrUpdate(key, sortedset.SCORE(m.counter), nil)
        return distance
    }
    m.set.AddOrUpdate(key, sortedset.SCORE(m.counter), nil)
    return -1
}
```

### Generating the MRC

```go
func GenerateMRC(trace []string, maxCap int) []float64 {
    m := New()
    hits := make([]int, maxCap+1)
    misses := 0
    for _, k := range trace {
        d := m.Access(k)
        if d < 0 {
            misses++
            continue
        }
        if d <= maxCap {
            hits[d]++
        } else {
            misses++
        }
    }
    // Cumulative
    cumulative := make([]float64, maxCap+1)
    total := len(trace)
    sum := 0
    for c := 1; c <= maxCap; c++ {
        sum += hits[c]
        cumulative[c] = float64(sum) / float64(total)
    }
    return cumulative
}
```

`cumulative[c]` is the LRU hit rate at capacity `c`. Plot it; you have the MRC.

### Why this is powerful

One pass through a trace gives you the hit rate at *every* capacity. You don't need to re-simulate for each size. Production teams use Mattson nightly to size their caches.

For 100M-event traces, the algorithm runs in minutes. For 1B+ events, sample down (1% sample is usually enough for MRC shape).

## Deep dive: ARC's adjustment function

The full ARC algorithm has four lists and a parameter `p` that adapts:

```text
            T1                   T2
[recent once] [recent twice or more]
   ↓                            ↓
   B1 (ghost)              B2 (ghost)
[evicted T1]              [evicted T2]
```

Constraint: `|T1| + |T2| = c` (capacity). `p` controls the target `|T1|` (so `|T2| = c - p`).

### Adjustment on hit in ghost

If a hit lands in B1, ARC increases `p` (T1 should be bigger):

```
p = min(p + max(|B2|/|B1|, 1), c)
```

If a hit lands in B2, ARC decreases `p`:

```
p = max(p - max(|B1|/|B2|, 1), 0)
```

The ratio terms ensure the adjustment is proportional to the relative ghost sizes — if B1 has many entries and B2 has few, hits in B1 are more informative.

### Replacement decision

When evicting:

- If `|T1| > p`, evict from T1.
- If `|T1| ≤ p`, evict from T2.

The eviction target follows `p`. As `p` grows, T1 takes more space; as it shrinks, T2 grows.

### Why it works mathematically

The ratio adjustment is similar to gradient descent. The function being minimized is the long-run miss rate; `p` adapts toward the optimum for the current workload. Convergence is empirical (no closed-form proof).

### Implementation pitfalls

- B1 and B2 are *ghost* lists — they hold keys but not values. Sized at `c` each, so total tracking is `4c` keys.
- The four lists must be consistent under concurrent access. Most implementations use a single lock.
- The arithmetic is integer; rounding decisions matter for small sizes.

## Worked example: choosing between LRU, ARC, and W-TinyLFU

Workload: web service with 100M req/day, 10M distinct keys, Zipf 1.0.

### Pre-evaluation

Working set (1 hour window): ~2M keys.

Cache capacity budget: 4 GB. With 500-byte values + 200-byte overhead, capacity ≈ 5.7M entries.

### Pencil-and-paper estimate

Working set 2M, cache 5.7M → cache fits 2.8x working set. Hit rate should be high regardless of policy.

For Zipf 1.0: head-tail concentrate accesses. Top 0.1M keys carry 50% of traffic. Tail keys are mostly one-time.

### Simulator results

Run a representative 1M-event trace through three implementations at capacity = 2M:

```
LRU       hit rate: 87.2%
ARC       hit rate: 89.1%
W-TinyLFU hit rate: 91.4%
```

W-TinyLFU wins by 4.2% over LRU. At 100M req/day:

```
4.2% × 100M = 4.2M extra hits/day
```

If each miss costs 10 ms latency and 1 ms DB time, those 4.2M misses cost:

```
4.2M × 1 ms = 70 minutes of DB time saved per day
4.2M × 10 ms × random fraction = significant latency reduction
```

Worth the engineering cost of switching to ristretto.

### Decision

Adopt ristretto. Roll out behind a flag. Validate metrics. Promote.

This is the kind of analysis that justifies the work.

## How caching changes when serializability matters

Most caches assume eventual consistency. For *serializable* workloads (financial, healthcare), the cache must guarantee a specific order of reads vs writes.

### Pattern: read-version-validate

Each cached entry has a version. The cache checks the version against a fast version store (Redis, in-memory) on every read:

```go
func (c *Cache) Get(k string) (*Value, error) {
    e, ok := c.inner.Get(k)
    if !ok {
        return c.load(k)
    }
    curVersion, _ := c.versionStore.Get(k)
    if curVersion != e.version {
        c.inner.Remove(k)
        return c.load(k)
    }
    return e.val, nil
}
```

Cost: every read is two operations (local cache + version store). The version store itself must scale.

### Pattern: write-with-validate

A write must check that no other write has occurred since the read. Uses a compare-and-swap on the version:

```go
func (c *Cache) UpdateIfVersion(k string, v *Value, expectedVersion uint64) error {
    if !c.versionStore.CompareAndSwap(k, expectedVersion, expectedVersion+1) {
        return ErrConflict
    }
    db.Update(k, v)
    c.inner.Add(k, entry{val: v, version: expectedVersion + 1})
    return nil
}
```

Two-phase commit-like. Works at moderate scale; expensive at very high write rates.

### When to avoid the cache

For truly serializable workloads, often the cache is more trouble than worth. The "cache" becomes a write-through buffer that mirrors the database; you might as well use the database directly with proper indexes.

Cache where staleness is OK; bypass where it isn't.

## A note on cache and observability

Caches are notoriously hard to debug because their state is internal and ephemeral. A few observability practices:

### Expose cache state via debug endpoint

```go
http.HandleFunc("/debug/cache", func(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "size=%d\n", cache.Len())
    fmt.Fprintf(w, "hits=%d\n", hits.Load())
    fmt.Fprintf(w, "misses=%d\n", misses.Load())
    fmt.Fprintf(w, "evictions=%d\n", evictions.Load())
    if r.URL.Query().Get("dump") == "1" {
        for _, k := range cache.Keys() {
            fmt.Fprintln(w, k)
        }
    }
})
```

Behind admin auth. Lets the on-call inspect the cache during incidents.

### Log evictions at a sample rate

```go
if evictCount % 10000 == 0 {
    log.Printf("evicted key=%s age=%v reason=%s", k, age, reason)
}
```

Most evictions are normal. Logging a sample tells you the typical pattern; spikes are visible in aggregate.

### Trace cache operations

OpenTelemetry spans on cache.Get are expensive (the span overhead dwarfs the operation). Use lighter mechanisms:

- Histograms of operation latency.
- Per-prefix metrics.
- Aggregate counters.

### Heap profile periodically

`pprof.WriteHeapProfile` every 5 minutes during high traffic gives you a record of cache memory over time. Useful for capacity planning.

## Cache implementation in interesting languages

For perspective:

### Caffeine (Java)

The dominant Java cache. W-TinyLFU + LRU + adaptive window. ~5K lines. Highly optimized; copied by many other-language libraries.

### moka (Rust)

Caffeine port. Same algorithm, Rust safety. Useful for systems programming.

### lru (Rust standard-library-adjacent)

Plain LRU. Mature, well-tested.

### Memcached (C)

The original distributed cache. Hash table + LRU + slab allocator. ~10K lines. Survived 20 years.

### Redis (C)

Not strictly a cache (it's a data store), but heavily used as one. LRU and TTL eviction; many variants of LRU.

### Caffeine Lua (LuaJIT)

A Lua port of Caffeine for OpenResty. Same ideas applied to a different runtime.

Across languages the patterns converge. The math (Mattson, ARC, TinyLFU) is universal; the implementations vary only in syntax and concurrency primitives.

## Designing for cache failures

A cache that fails badly is worse than no cache. Plan for failure modes:

### Failure: cache library has a bug

Test in canary before fleet-wide rollout. Have a fallback path (bypass the cache).

### Failure: cache memory exhausted

Eviction policy keeps memory bounded. But what if eviction fails (callback panics)? Recover or restart. Alert if cache size diverges from expected.

### Failure: cache is slow

If cache.Get takes longer than DB.Get, the cache is harmful. Profile periodically; alert on regression.

### Failure: cache is wrong

Stale data, version mismatches, corrupted values. Add validation: checksums, version checks, periodic re-loading.

### Failure: cache disagrees with replicas

Inter-pod inconsistency. Pub/sub or CDC. Validate the path during deployment.

A robust cache anticipates and survives all these.

## The future of caching

Predictions for 2026-2030:

1. **S3-FIFO becomes the default.** Simpler than W-TinyLFU, comparable or better hit rate.
2. **ML-driven caches.** Small neural networks predict eviction better than handcrafted policies, especially for skewed workloads.
3. **Persistent caches integrated with storage tiers.** CXL memory, MRAM, etc.
4. **Adaptive concurrency.** Caches automatically adjust shard count based on observed contention.
5. **Workload-aware compilers.** Static analysis identifies cacheable code paths automatically.

These are not certain. Caching is a 60-year-old field; it evolves slowly. The principles in this file will remain relevant.

## A summary by analogy

LRU is like memorizing the last 10 things you heard. Sometimes useful; sometimes you keep junk and forget important things.

LFU is like memorizing things you hear often. Better for habitual patterns; bad for sudden new important things.

ARC is like both, with a teacher who tells you which one to trust this week.

LIRS is like remembering only things you've heard twice in a short span. Sharp filter; some early misses.

W-TinyLFU is like memorising in two phases: a notebook (window) for new things, then a permanent memory (main) for things you really keep.

S3-FIFO is three timed queues with a "second chance" rule. New things go to a holding area; promote on reuse; ghost-remember evictions.

Belady is a precognitive psychic who knows what's coming. Cheating but useful as a benchmark.

## Closing reflections

This file went deep. You may not have understood every detail on first reading. That is fine. Bookmark this; return to specific sections as your work touches them.

The professional level of any topic is not "I memorize everything." It is "I have read enough to know where to look and how to evaluate." The reading list in this file is the most valuable part — those papers will outlive any Go-specific advice.

Cache wisely. Measure relentlessly. Simplify when possible. Trust the math when you have it; trust measurement when you don't.



For pedagogical purposes, here is a TinyLFU admission filter you can build and benchmark.

```go
package tinylfu

import (
    "hash/maphash"
    "sync"
    "sync/atomic"
)

// CMS is a Count-Min Sketch with 4 rows of 4-bit counters.
type CMS struct {
    rows  [4][]uint64
    seed  [4]uint64
    mask  uint64
    width uint64
}

func NewCMS(width uint64) *CMS {
    if width&(width-1) != 0 {
        panic("CMS width must be power of two")
    }
    c := &CMS{width: width, mask: width - 1}
    for i := range c.rows {
        c.rows[i] = make([]uint64, width/16)
        c.seed[i] = uint64(i)*0x9E3779B97F4A7C15 + 1
    }
    return c
}

func (c *CMS) Increment(h uint64) {
    for i := range c.rows {
        idx := (h ^ c.seed[i]) & c.mask
        word := idx / 16
        shift := (idx % 16) * 4
        v := atomic.LoadUint64(&c.rows[i][word])
        cur := (v >> shift) & 0xF
        if cur < 15 {
            newV := v + (1 << shift)
            atomic.StoreUint64(&c.rows[i][word], newV)
        }
    }
}

func (c *CMS) Estimate(h uint64) uint64 {
    var min uint64 = 15
    for i := range c.rows {
        idx := (h ^ c.seed[i]) & c.mask
        word := idx / 16
        shift := (idx % 16) * 4
        v := atomic.LoadUint64(&c.rows[i][word])
        cnt := (v >> shift) & 0xF
        if cnt < min {
            min = cnt
        }
    }
    return min
}

// Reset halves all counters.
func (c *CMS) Reset() {
    for i := range c.rows {
        for j := range c.rows[i] {
            v := atomic.LoadUint64(&c.rows[i][j])
            atomic.StoreUint64(&c.rows[i][j], (v>>1)&0x7777777777777777)
        }
    }
}

// Doorkeeper is a bloom filter that absorbs first accesses.
type Doorkeeper struct {
    bits []uint64
    seed uint64
    mask uint64
}

func NewDoorkeeper(size uint64) *Doorkeeper {
    if size&(size-1) != 0 {
        panic("Doorkeeper size must be power of two")
    }
    return &Doorkeeper{
        bits: make([]uint64, size/64),
        seed: 0xCAFEBABE,
        mask: size - 1,
    }
}

func (d *Doorkeeper) ContainsOrAdd(h uint64) bool {
    idx := (h ^ d.seed) & d.mask
    word := idx / 64
    bit := uint64(1) << (idx % 64)
    for {
        v := atomic.LoadUint64(&d.bits[word])
        if v&bit != 0 {
            return true // already present
        }
        if atomic.CompareAndSwapUint64(&d.bits[word], v, v|bit) {
            return false // newly added
        }
    }
}

func (d *Doorkeeper) Reset() {
    for i := range d.bits {
        atomic.StoreUint64(&d.bits[i], 0)
    }
}

// TinyLFU combines the doorkeeper and CMS.
type TinyLFU struct {
    door     *Doorkeeper
    cms      *CMS
    sampled  atomic.Uint64
    sampleCap uint64
    seed     maphash.Seed
}

func New(size uint64) *TinyLFU {
    return &TinyLFU{
        door:      NewDoorkeeper(size),
        cms:       NewCMS(size),
        sampleCap: size * 8, // age after 8x size accesses
        seed:      maphash.MakeSeed(),
    }
}

func (t *TinyLFU) hash(key string) uint64 {
    var h maphash.Hash
    h.SetSeed(t.seed)
    h.WriteString(key)
    return h.Sum64()
}

func (t *TinyLFU) Increment(key string) {
    h := t.hash(key)
    if !t.door.ContainsOrAdd(h) {
        return // first access, absorbed by doorkeeper
    }
    t.cms.Increment(h)
    if t.sampled.Add(1) > t.sampleCap {
        t.cms.Reset()
        t.door.Reset()
        t.sampled.Store(0)
    }
}

func (t *TinyLFU) Estimate(key string) uint64 {
    h := t.hash(key)
    if t.door.ContainsOrAdd(h) {
        return t.cms.Estimate(h) + 1
    }
    return 1 // first access counts as 1
}
```

To use it as an admission filter for an LRU:

```go
type AdmittedCache struct {
    lru     *lru.Cache[string, *Value]
    admit   *TinyLFU
}

func (c *AdmittedCache) Add(key string, v *Value) {
    c.admit.Increment(key)
    if _, ok := c.lru.Peek(key); ok {
        c.lru.Add(key, v) // already in cache, update
        return
    }
    if c.lru.Len() < c.lru.Capacity() {
        c.lru.Add(key, v) // capacity available
        return
    }
    // Cache full — would-be victim
    victim, _, _ := c.lru.GetOldest()
    candidateFreq := c.admit.Estimate(key)
    victimFreq := c.admit.Estimate(victim)
    if candidateFreq > victimFreq {
        c.lru.Add(key, v) // admit; victim evicted automatically
    }
    // else: drop the candidate
}
```

This is the TinyLFU pattern in 200 lines. ristretto's version is ~3000 lines of optimized, tested code that handles edge cases, concurrent updates, and SIMD operations.

## Building a workload simulator

To evaluate cache algorithms offline, you need a workload simulator. Here is a minimal one:

```go
package simulator

import (
    "math/rand"
    "sort"
)

type Workload struct {
    Trace []string
}

// Zipfian generates a Zipf-distributed workload.
func Zipfian(n int, s float64, length int, seed int64) *Workload {
    r := rand.New(rand.NewSource(seed))
    // Pre-compute Zipf probabilities and cumulative.
    weights := make([]float64, n)
    var sum float64
    for i := 1; i <= n; i++ {
        w := 1.0 / pow(float64(i), s)
        weights[i-1] = w
        sum += w
    }
    for i := range weights {
        weights[i] /= sum
    }
    cumulative := make([]float64, n)
    cumulative[0] = weights[0]
    for i := 1; i < n; i++ {
        cumulative[i] = cumulative[i-1] + weights[i]
    }
    trace := make([]string, length)
    for i := range trace {
        x := r.Float64()
        idx := sort.SearchFloat64s(cumulative, x)
        trace[i] = "key-" + itoa(idx)
    }
    return &Workload{Trace: trace}
}

// Sequential generates a scan workload.
func Sequential(n int) *Workload {
    trace := make([]string, n)
    for i := range trace {
        trace[i] = "key-" + itoa(i)
    }
    return &Workload{Trace: trace}
}

// Mix combines two workloads with a ratio.
func Mix(a, b *Workload, ratioA float64, length int, seed int64) *Workload {
    r := rand.New(rand.NewSource(seed))
    trace := make([]string, length)
    ai, bi := 0, 0
    for i := range trace {
        if r.Float64() < ratioA && ai < len(a.Trace) {
            trace[i] = a.Trace[ai]
            ai++
        } else if bi < len(b.Trace) {
            trace[i] = b.Trace[bi]
            bi++
        } else {
            trace[i] = a.Trace[ai%len(a.Trace)]
            ai++
        }
    }
    return &Workload{Trace: trace}
}
```

Then evaluate a cache:

```go
type CacheLike interface {
    Get(string) (interface{}, bool)
    Add(string, interface{})
}

func Evaluate(c CacheLike, w *Workload) (hits, misses int) {
    for _, k := range w.Trace {
        if _, ok := c.Get(k); ok {
            hits++
        } else {
            misses++
            c.Add(k, struct{}{})
        }
    }
    return
}
```

Now you can compare algorithms:

```go
zipf := Zipfian(10000, 1.0, 1_000_000, 42)
scan := Sequential(10000)
mixed := Mix(zipf, scan, 0.9, 1_000_000, 43)

for _, name := range []string{"lru", "tinylfu", "s3fifo"} {
    c := makeCache(name, 1000)
    h, m := Evaluate(c, mixed)
    fmt.Printf("%-10s hit rate: %.2f%%\n", name, 100*float64(h)/float64(h+m))
}
```

A real comparison requires running multiple traces and aggregating. This skeleton gets you started.

## Designing the cache for a hypothetical workload

Suppose you are designing a cache for a service with these properties:

- 50M req/s sustained.
- Each request reads 3 cached values.
- 80% of traffic on 20% of keys (Zipf, s ≈ 0.9).
- Working set ~5M distinct keys.
- 5-minute freshness OK.
- Values average 500 bytes.

### Step 1: Capacity

Working set 5M × 2x headroom = 10M entries. At 500 bytes + 100 bytes overhead = 600 bytes per entry. Total cache size = 6 GB.

### Step 2: Sharding

50M req/s × 3 reads = 150M reads/s. At 200 ns/op single-mutex, max throughput is 5M/s — need sharding.

Target shards: 150M / 5M = 30 shards minimum. Round up to 64 (power of two) for safety.

### Step 3: Algorithm choice

Zipf 0.9 with strong working-set bound: LRU is OK; W-TinyLFU is better (~5% improvement).

Working set size means scans are unlikely (no scan resistance needed unless workload changes).

**Choice**: ristretto with appropriate cost (500 bytes per entry, MaxCost = 6 GB).

### Step 4: Memory

6 GB on-heap will stress GC. Allocation rate at 150M ops/s × 100 bytes = 15 GB/s if every op allocated. ristretto reduces this; lossy buffers absorb most ops without allocation.

GC pause estimate: 6 GB heap × 10 ms/GB = 60 ms. Once per minute. Acceptable for many services; alarming for low-latency services.

**Mitigation**: GOGC=50 to GC more often (smaller pauses). If that fails, off-heap (freecache, sized as 6 GB).

### Step 5: TTL

5-minute freshness → TTL = 4 minutes (safety margin). ristretto's `SetWithTTL`.

### Step 6: Coherence

Multi-pod fleet means each pod has its own ristretto. Stale entries up to 4 minutes after a write. Acceptable per requirements.

### Step 7: Observability

Hit rate, eviction rate, dropped Set count, mutex contention. Per-key-prefix breakdown.

### Step 8: Rollout

Behind a flag. Compare to existing cache for 24 hours. Promote if hit rate ≥ target.

### Result

A ristretto cache, 64 shards, 6 GB capacity, 4-minute TTL, deployed across N pods. Expected hit rate 90-95%; 99th-percentile latency ~10 µs (cache hit) or ~5 ms (cache miss + DB).

This is the design exercise senior engineers perform. The architecture follows from measured workload properties.

## Cache coordination at scale

For services where multi-pod cache consistency is critical, several patterns coexist:

### Pattern: write through Redis

```go
db.Update(u)
redis.Set("user:" + u.ID, marshal(u), ttl)
localCache.Remove(u.ID) // optional; will pick up from Redis on next read
```

All pods read from Redis (which is consistent). The local cache is opportunistic. Simpler than pub/sub.

### Pattern: change data capture (CDC)

Database changes go to a Kafka topic. Every pod subscribes; invalidates its local cache on relevant events. Standard in modern microservice architectures.

```go
sub := kafka.Subscribe("db-changes")
for msg := range sub {
    var change Change
    json.Unmarshal(msg.Value, &change)
    if change.Table == "users" {
        localCache.Remove("user:" + change.ID)
    }
}
```

Latency: 50-500 ms from write to cache invalidation. Acceptable for most consistency needs.

### Pattern: lease-based caching

Each cache entry has a lease (token). On read, check the lease against a central authority. Invalid leases → miss + reload + new lease.

```go
v, lease, _ := localCache.GetWithLease(k)
if !leases.Validate(k, lease) {
    v, _ = db.Get(k)
    localCache.AddWithLease(k, v, leases.Issue(k))
}
```

Strong consistency at the cost of an extra round-trip per read. Used in stateful services (Spanner, FoundationDB).

### Pattern: gossip-based invalidation

Each pod gossips invalidations to peers. No central coordinator. Eventually-consistent but resilient to single-point failures.

Complex; rare outside specialized systems.

## Multi-tenant caching

A single service serving multiple tenants must share the cache fairly:

### Problem: tenant pollution

A busy tenant fills the cache, evicting others' hot data. The other tenants suffer.

### Solution 1: per-tenant cache

Each tenant has a dedicated cache. Total memory is `tenants × per-tenant cap`.

Pro: complete isolation. Con: memory grows with tenants.

### Solution 2: fair sharing

A single cache, but track per-tenant usage and limit each. The eviction policy picks the tenant currently over-quota.

```go
type FairCache struct {
    inner    *lru.Cache[string, entryWithTenant]
    quotas   map[string]int // tenant → max entries
    counts   map[string]int // tenant → current count
}

func (c *FairCache) Add(tenant, k string, v interface{}) {
    if c.counts[tenant] >= c.quotas[tenant] {
        c.evictFromTenant(tenant)
    }
    c.inner.Add(tenant + ":" + k, entryWithTenant{val: v, tenant: tenant})
    c.counts[tenant]++
}
```

Complex; rarely worth the engineering effort. Per-tenant caches are simpler.

### Solution 3: TinyLFU per-tenant

Each tenant has its own admission counter. A tenant's keys must prove popularity within that tenant. Naturally limits pollution.

ristretto does not support this out of the box but the architecture is sound.

## Cache testing strategies

### Unit tests

Standard Set/Get/Remove sequences. Verify invariants.

### Property tests

Random op sequences. Verify size invariants, no panics, no data races.

### Stress tests

High concurrency, long duration, real-like workloads.

### Trace replay

Real production traces fed through cache implementations. The gold standard for hit-rate validation.

### Chaos tests

Inject failures (downstream errors, slow callbacks, OOMs) and verify graceful degradation.

For caches at scale, all five are necessary. Tests without trace replay miss workload-specific bugs. Tests without chaos miss failure-mode bugs.

## Microbenchmarking pitfalls

A few things to be careful of when benchmarking caches:

### Pitfall 1: cold cache

If your benchmark starts with an empty cache, the first half is dominated by inserts. The hit rate is artificially low.

Fix: warm the cache before `b.ResetTimer()`.

### Pitfall 2: small sample size

`b.N` of 100 is not enough to amortize allocation costs. Increase the work per iteration.

Fix: Loop inside the benchmark body.

### Pitfall 3: predictable keys

Sequential keys are too easy. Real workloads are random or Zipf.

Fix: Use `rand.New` with a fixed seed for reproducibility.

### Pitfall 4: single goroutine

A benchmark on one goroutine misses contention. Use `b.RunParallel`.

### Pitfall 5: hot cache size

A cache that fits in L3 is faster than one that does not. Test at realistic sizes.

### Pitfall 6: ignoring GC

A long-running benchmark may trigger GC mid-run, perturbing results. Pre-allocate; force GC before timing.

### Pitfall 7: trusting one machine

Benchmarks on a developer laptop tell you nothing about production. Run on representative hardware.

## A look at S3-FIFO's implementation

A skeleton of S3-FIFO in Go:

```go
package s3fifo

import (
    "container/list"
    "sync"
    "sync/atomic"
)

type Cache[K comparable, V any] struct {
    mu       sync.Mutex
    smallCap int
    mainCap  int
    small    *list.List
    main     *list.List
    ghost    map[K]struct{}
    items    map[K]*entry[K, V]
}

type entry[K comparable, V any] struct {
    key   K
    val   V
    count atomic.Uint32 // saturates at 3
    queue *list.List
    elem  *list.Element
}

func (c *Cache[K, V]) Get(k K) (V, bool) {
    c.mu.Lock()
    defer c.mu.Unlock()
    e, ok := c.items[k]
    if !ok {
        var zero V
        return zero, false
    }
    // Saturating increment 0..3
    for {
        cur := e.count.Load()
        if cur >= 3 {
            break
        }
        if e.count.CompareAndSwap(cur, cur+1) {
            break
        }
    }
    return e.val, true
}

func (c *Cache[K, V]) Add(k K, v V) {
    c.mu.Lock()
    defer c.mu.Unlock()
    if _, ok := c.items[k]; ok {
        return // already present
    }
    if _, inGhost := c.ghost[k]; inGhost {
        c.insertToMain(k, v)
        delete(c.ghost, k)
        return
    }
    c.insertToSmall(k, v)
}

func (c *Cache[K, V]) insertToSmall(k K, v V) {
    if c.small.Len() >= c.smallCap {
        c.evictFromSmall()
    }
    e := &entry[K, V]{key: k, val: v, queue: c.small}
    e.elem = c.small.PushFront(e)
    c.items[k] = e
}

func (c *Cache[K, V]) evictFromSmall() {
    back := c.small.Back()
    if back == nil {
        return
    }
    e := back.Value.(*entry[K, V])
    c.small.Remove(back)
    if e.count.Load() >= 1 {
        // promote to main
        if c.main.Len() >= c.mainCap {
            c.evictFromMain()
        }
        e.queue = c.main
        e.elem = c.main.PushFront(e)
        e.count.Store(0) // reset on promotion
    } else {
        // demote to ghost
        delete(c.items, e.key)
        c.ghost[e.key] = struct{}{}
        // ghost size cap omitted for brevity
    }
}

func (c *Cache[K, V]) evictFromMain() {
    back := c.main.Back()
    if back == nil {
        return
    }
    e := back.Value.(*entry[K, V])
    c.main.Remove(back)
    if e.count.Load() >= 1 {
        // reinsert at front, reset count
        e.count.Store(0)
        e.elem = c.main.PushFront(e)
    } else {
        delete(c.items, e.key)
        c.ghost[e.key] = struct{}{}
    }
}
```

Properties:

- **Get is atomic-only on hot path.** No list mutation.
- **Add takes the lock once per call.** Evictions are batched.
- **No need to track exact recency.** The FIFO order plus per-entry counter suffices.

Performance: comparable to W-TinyLFU on most workloads, with simpler implementation and better lock concurrency.

## Mathematical proofs you should be able to sketch

A few proofs worth knowing:

### LRU is competitive with offline

Theorem (Sleator & Tarjan 1985): LRU is `k`-competitive, where `k` is the cache size. I.e., for any sequence, LRU's miss count is at most `k` times the offline optimal.

Proof sketch: consider an adversary's sequence of length `m`. Partition into phases of `k` distinct accesses. Each phase produces at most `k` misses for LRU and at least 1 miss for any algorithm. Ratio is `k`.

This is loose for typical workloads (real ratio is 1.1-1.5), but the proof shows LRU's worst case.

### Belady's anomaly does not affect LRU

LRU has the *stack property*: increasing cache size never increases miss count. Adding a slot can only convert a miss to a hit.

FIFO does NOT have the stack property. Belady's 1969 paper showed FIFO can have *more* misses with *more* capacity.

This is why LRU is preferred over FIFO when miss-count monotonicity matters.

### TinyLFU's space efficiency

For `N` keys with skew `s`, TinyLFU's sketch needs `O(N^(1/s) log N)` bits to rank keys correctly with high probability. For Zipf `s = 1`, this is `O(N log N)` — the same as a full counter table. For `s = 2`, it is `O(sqrt(N) log N)` — much smaller.

The takeaway: TinyLFU's compression advantage grows with workload skew.

## Reading list expanded

Beyond the senior-level list:

- **"Algorithms for Caching Mobile Web Objects"** — practical issues at scale.
- **"On Replacement Algorithms in Caching"** (1995, Aho/Denning/Ullman) — survey of the early work.
- **"The LRU-K Page Replacement Algorithm"** (O'Neil et al. 1993) — generalizes LRU using the Kth-most-recent access.
- **"FBR: A Working Memory Management System"** (Robinson & Devarakonda 1990) — frequency-based replacement.
- **"Multi-Queue Replacement Algorithm"** (Zhou et al. 2001) — generalizes 2Q.
- **"Cache-Conscious Concurrent Data Structures"** (chapter in Herlihy/Shavit) — concurrent linked structures.
- **"The Cache-Oblivious Algorithms Bibliography"** — algorithms that work well at every cache level.

Most are 10-30 pages. Read one a week and in a year you have read the field.

## A long quote from the literature

From Megiddo & Modha's ARC paper:

> Self-tuning is a desirable property for any algorithm. Our algorithm continually adapts to the workload, and outperforms both LRU and LFU on a wide variety of workloads, often by significant margins.

This sentence captures the modern view: workloads are not stationary; algorithms must adapt. W-TinyLFU and ARC are the two best-known adaptive caches. S3-FIFO is the new contender, simpler than both.

## Closing reflections

After reading this file, you should be able to:

1. Look at a service's traffic graph and predict cache behavior.
2. Read a cache paper and reproduce its experiments.
3. Design a cache for a workload measured in tens of billions of operations.
4. Profile a cache's CPU, memory, and lock behavior at microarchitecture level.
5. Choose between LRU, LFU, ARC, LIRS, W-TinyLFU, S3-FIFO based on workload properties.
6. Implement any of the above from scratch given a weekend.

Most engineers never reach this level. Those who do shape the field. The literature is open; the tools are public; the experiments are reproducible. The barrier is time, not access.

## Summary

Professional-level caching is systems theory applied to a specific problem. You know the algorithms (LRU, LFU, ARC, LIRS, W-TinyLFU, S3-FIFO) and their theoretical foundations. You can characterize workloads, simulate cache behavior offline, and design a cache topology for any service scale. You read the original papers and contribute to the literature.

This file is the foundation. The next step is to apply it: profile real workloads, read real papers, build a cache that earns its complexity. The field continues to evolve — new algorithms (S3-FIFO is the most recent breakthrough) emerge every few years.

The specification, interview, tasks, find-bug, and optimize files give you concrete contexts to apply this material.
