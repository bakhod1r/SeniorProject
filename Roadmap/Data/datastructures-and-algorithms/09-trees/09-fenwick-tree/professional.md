# Fenwick Tree — Professional Level

> **Audience:** Engineers building latency-critical systems and library authors who need to know the BIT at the hardware level. Prerequisite: all earlier levels.

This document covers the **systems engineering** side of Fenwick trees: cache-line behavior, SIMD parallelism, the O(n) build's proof, persistent BIT, lock-free concurrent updates, 64-bit overflow semantics, and a sketch of BIT-based Bloom-filter extensions.

---

## Table of Contents

1. [Cache-Line Analysis vs Segment Tree](#cache)
2. [SIMD-Parallel BIT Updates Across Independent Streams](#simd)
3. [The O(n) Build Trick — Proof and Implementation](#build)
4. [Persistent BIT via Path Copying](#persistent)
5. [Lock-Free Concurrent BIT with Fetch-Add](#concurrent)
6. [64-Bit Overflow and Modular Semantics](#overflow)
7. [BIT in Bloom-Filter Sketching Extensions](#bloom)

---

<a name="cache"></a>
## 1. Cache-Line Analysis vs Segment Tree

A typical x86-64 cache line is 64 bytes — 8 `int64` values or 16 `int32` values. For a BIT of size `n+1` int64s, the total memory is `8(n+1)` bytes. Per-operation cache traffic:

- **Update (`while i <= n: tree[i] += d; i += i & -i`).** The first iteration touches `tree[i]`. Subsequent iterations touch increasingly far-apart cells: `i, i + lowbit(i), ...`. The distances grow geometrically. For large `n`, the iterations after the first few miss L1.
- **Prefix (`while i > 0: s += tree[i]; i -= i & -i`).** Similar pattern descending.

For `n = 10^6` (8 MB BIT, larger than typical L2), the working set straddles L2 and L3. Each operation visits ~20 cells; under uniform access, this generates ~10–15 cache-line touches. Throughput: roughly 5–8 ns per operation on modern hardware, fully bottlenecked by memory.

A segment tree of 4n int64 (32 MB for n=10^6) typically spills into RAM. Per-operation cache traffic is similar (log n cells), but each cell is farther in memory and the underlying tree structure has worse spatial locality. Empirically, BITs are 2–3× faster on this workload — see `middle.md` benchmark.

For small `n` (where the BIT fits in L1, say `n ≤ 4096` int64), the difference disappears and both structures hit ~1 ns per operation.

---

<a name="simd"></a>
## 2. SIMD-Parallel BIT Updates Across Independent Streams

A single BIT update is inherently sequential — each iteration depends on the previous `i`. SIMD cannot speed up *one* BIT update.

What SIMD *can* parallelize is **many independent BITs updated together**. Consider a 2D grid of independent BITs, each tracking a separate metric. A typical batch operation: update K independent BITs with the same index `i` and the same delta. Using AVX-512, you can process 8 int64 BITs per cycle (or 16 int32 BITs).

This pattern shows up in:

- **Multi-channel time-series accelerators**: 8 metrics on the same time bucket grid; update them all together.
- **Histogram batteries**: K independent histograms with the same value distribution, e.g., percentile sketches for K backend servers updated in lockstep.
- **GPU kernels**: launch a thread block per BIT, all walking the same index path in parallel.

The trick is that each BIT's update visits *the same* sequence of indices, so the same instructions step through all BITs simultaneously. With SoA (struct-of-arrays) layout — a single array `tree[i][bit_id]` indexed by `i` first — gathering 8 cells from 8 BITs is one AVX-512 gather instruction. Throughput scales linearly with vector width.

---

<a name="build"></a>
## 3. The O(n) Build Trick — Proof and Implementation

### Why naive build is O(n log n)

The straightforward build calls `update(i, A[i])` for `i = 1..n`. Each update is O(log n), so total is O(n log n). For `n = 10^7`, this is ~200 million operations. Doable but wasteful when an O(n) build exists.

### The absorbing pattern

```
for i in 1..n:
    parent = i + (i & -i)
    if parent <= n:
        tree[parent] += tree[i]
```

The setup before this loop: `tree[i] = A[i]` for all `i`. The loop walks left to right and adds each `tree[i]` to its parent `tree[i + lowbit(i)]`.

### Proof of correctness

We prove by strong induction on `i` that after processing all indices `1..i`, `tree[i]` equals the sum of A over its responsibility range `[i - lowbit(i) + 1, i]`.

**Base case (`i = 1`)**: lowbit(1) = 1, responsibility range = [1, 1]. `tree[1]` was initialized to `A[1]` and was never modified (because every child of 1 would have index less than 1, which don't exist). So `tree[1] = A[1]`. ✓

**Inductive step**: assume the property holds for all indices `< i`. Index `i`'s responsibility range has length `lowbit(i) = 2^k` for some `k`. This range splits into two halves: `[i - 2^k + 1, i - 2^{k-1}]` and `[i - 2^{k-1} + 1, i]`. The right half is the responsibility range of `i - 2^{k-1}`... wait, let me recompute.

Actually, the responsibility range of `i` decomposes into its own initial slot `A[i]` plus the responsibility ranges of all `j < i` whose responsibility range falls entirely within `[i - lowbit(i) + 1, i - 1]`. These are exactly the `j` whose parent is `i`. By induction, each such `tree[j]` already equals the sum of its responsibility range. So when we add `tree[j]` to `tree[i]` in the loop iteration for `j`, we are accumulating that subtotal into `tree[i]`. After all `j < i` with parent = i have been processed, `tree[i]` equals the sum of its responsibility range. ✓

Total work: one pass with O(1) per index → **O(n)**.

### Implementation (Go)

```go
func BuildInPlace(arr []int64) []int64 {     // arr is 1-indexed, len = n+1
    n := len(arr) - 1
    tree := make([]int64, n+1)
    copy(tree, arr)
    for i := 1; i <= n; i++ {
        parent := i + (i & -i)
        if parent <= n {
            tree[parent] += tree[i]
        }
    }
    return tree
}
```

The version above allocates a new slice. If memory is tight you can build in place by treating `arr` directly as the tree (just walk and absorb).

---

<a name="persistent"></a>
## 4. Persistent BIT via Path Copying

A **persistent BIT** retains all historical versions: `update` produces a new version that can be queried independently while the old version remains intact. This is rare in production (persistent segment trees are more common), but the technique is straightforward.

Per update, only `O(log n)` cells are modified. Path-copy those cells: allocate a new array slot for each modified `tree[i]`, leave the rest sharing the old representation. After `q` updates, total memory is `O(n + q log n)`.

In practice, persistent BITs are implemented as immutable maps keyed by `i`. Persistent functional data structures in Clojure, Haskell, or Scala (e.g., `IntMap`) provide the underlying sharing.

When you might want one:
- Versioned analytics: "what was the rank of player X yesterday?".
- Replayable simulation states.
- Functional programming style with snapshot guarantees.

A persistent BIT is rarely the right choice in production-throughput-critical paths because the per-update memory allocation dominates. For high-throughput needs, prefer write-ahead logging on a single mutable BIT and rebuild snapshots on demand.

---

<a name="concurrent"></a>
## 5. Lock-Free Concurrent BIT with Fetch-Add

A BIT update touches `O(log n)` cells, each updated by `tree[i] += delta`. If updates can be performed atomically per cell (e.g., `std::atomic<int64>` in C++, `AtomicLong` in Java, `atomic.AddInt64` in Go), then **concurrent updates do not need a global lock**. Each cell serializes its own updates via the hardware's cache coherence (LOCK XADD on x86, LDAXR/STLXR pairs on ARM).

```go
import "sync/atomic"

type ConcurrentFenwick struct {
    n    int
    tree []int64                     // accessed via atomic ops
}

func (f *ConcurrentFenwick) Update(i int, delta int64) {
    for ; i <= f.n; i += i & -i {
        atomic.AddInt64(&f.tree[i], delta)
    }
}

func (f *ConcurrentFenwick) Prefix(i int) int64 {
    var s int64
    for ; i > 0; i -= i & -i {
        s += atomic.LoadInt64(&f.tree[i])
    }
    return s
}
```

### Caveats

1. **Linearizability is not free.** A concurrent `Prefix` call may interleave with concurrent updates and observe a partial state — the prefix accumulates some cells before they were updated and others after. The result is consistent only in the sense that it is **some** valid prefix between the snapshot at call start and the snapshot at call end. For analytics this is usually fine; for trading systems where exact instantaneous prefixes are required, you need a global snapshot mechanism (e.g., epoch-based reclamation).

2. **Contention.** Cells near the root (powers of two, especially `tree[n]`-style cells covering large responsibility ranges) become hot spots. All updates touch them. On a many-core system this serializes contention to L3.

3. **False sharing.** Adjacent cells that fall into the same cache line will contend even when updated by different threads. Pad cells to 64 bytes or use SoA layout for genuinely parallel workloads.

For most real cases, a per-shard BIT with eventual aggregation is faster than a single concurrent BIT — the constant factor of per-cell atomics is 5–10× that of a normal store.

---

<a name="overflow"></a>
## 6. 64-Bit Overflow and Modular Semantics

Even 64-bit BITs can overflow if individual values are large (10^18) and many of them accumulate into the same cell. The total in `tree[n]` (which holds the entire array sum) can be the sum of `n` values, each up to 10^18 — overflow possible for `n ≥ 10`.

### Mitigations

1. **Use unsigned 64-bit.** `uint64` overflow wraps around cleanly with defined semantics in Go and Java's `Long.toUnsignedString`. For sum aggregates this is **wrong** but for XOR aggregates it is fine.

2. **Use 128-bit accumulators internally.** Go's `math/big` is too slow. Java's `BigInteger` is too slow. The pragmatic answer is to bound the inputs: validate each `delta` such that `|delta| ≤ M` and assert `n · M ≤ 2^63 - 1`.

3. **Document modular semantics explicitly.** If you choose to allow wrap-around (e.g., for a checksum-style BIT), document it loudly in the API. Callers who don't read docs will be confused.

4. **Use two 64-bit fields for a 128-bit cell.** Doubles memory but supports `n = 10^18` and `M = 10^18` simultaneously.

### Real-world example

In a financial analytics BIT tracking cumulative trade volume, `M ≈ 10^12` (large trades in micro-units) and `n ≈ 10^8` (timestamps per day). Total `≈ 10^20`. Exceeds `2^63 ≈ 9.2 · 10^18`. The team used `__int128` (GCC extension) for cells, accepting the 2× memory cost. Latency was unchanged on x86-64 because `__int128` arithmetic is two-instruction.

---

<a name="bloom"></a>
## 7. BIT in Bloom-Filter Sketching Extensions

A **counting Bloom filter** generalizes a Bloom filter by using small counters in each bucket instead of bits. This supports deletion at the cost of counter-width memory. Counters are typically 4–8 bits.

Some research-grade sketches replace the counter array with a BIT to support:
- **Range deletions**: "decrement all buckets in [b1, b2] by 1".
- **Range membership queries**: "what fraction of buckets in [b1, b2] are nonzero?".

The BIT enables range-update + range-query on the counter array, useful in **streaming set-difference** and **distinct-count over windows** algorithms. Examples appear in the academic literature on multi-set Bloom variants (e.g., Spectral Bloom filters with deletion support).

This is niche, but it shows the BIT's versatility: any time you need "aggregate over a range of cells under updates", a BIT is a candidate.

---

## Summary

The Fenwick tree's professional value: it fits in cache, allows SIMD across independent streams, builds in true O(n), persists and parallelizes when needed, and can be extended with 64-bit care. For library authors, the structure is small enough to inline. For system designers, it is the right default for any prefix-aggregate-with-updates problem until a non-invertible operation forces an upgrade to segment trees.
