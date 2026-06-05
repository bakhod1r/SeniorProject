# Square Root Decomposition & Mo's Algorithm — Professional Level

> **Read time: ~20 minutes** · **Audience:** Performance engineers tuning sqrt-decomp for hardware: SIMD, cache hierarchies, parallel query execution, adaptive bucketing.

At this level we stop treating `B = √n` as sacred. We pick `B` to fit the L1 cache, vectorize the partial scans with AVX/NEON, parallelize Mo's algorithm across cores, and design adaptive structures that re-balance buckets under skewed workloads.

---

## Table of Contents

1. [Block Size for Cache Levels](#cache)
2. [SIMD Acceleration of Partial Scans](#simd)
3. [Struct-of-Arrays for Bucket Aggregates](#soa)
4. [Parallelizing Mo's Algorithm](#parallel-mo)
5. [Hilbert-Curve Ordering — Implementation](#hilbert)
6. [Adaptive Block Sizing](#adaptive)
7. [Hierarchical Bucketing (√√n)](#hierarchical)
8. [Limits and When to Switch](#limits)
9. [Further Reading](#further-reading)

---

<a name="cache"></a>
## 1. Block Size for Cache Levels

The textbook choice `B = √n` minimizes the **operation count** but ignores the cost-per-operation hierarchy. For a 32 KB L1 data cache and 8-byte int values:

```
B_L1 = L1_size / sizeof(elem) / 2 = 32_768 / 8 / 2 = 2048
```

The `/2` leaves room for the aggregate array. For `n = 4·10⁶`, `√n = 2000`, which **happens to match** the L1-fit value — sqrt-decomp performs near optimally. For `n = 10⁸`, `√n = 10_000` — the partial bucket no longer fits in L1, costing ~3x slowdown.

The practical recipe:
1. Start with `B = round(√n)`.
2. If `B · sizeof(elem) > L1_size / 2`, set `B = L1_size / sizeof(elem) / 2`.
3. Pad `B` up to a multiple of 16 (AVX-512 vector width) or 8 (AVX2).

For huge `n`, accept that some partial scans miss L1 and either:
- Switch to **2-level sqrt-decomp** (`√√n` per level — see [Section 7](#hierarchical)),
- Or switch to a true segment tree (`O(log n)`).

---

<a name="simd"></a>
## 2. SIMD Acceleration of Partial Scans

The partial-bucket scan is a **dependency-free reduction**: ideal for SIMD. AVX2 processes 8 int32 per cycle; AVX-512 processes 16. With proper alignment and no early termination, the inner loop:

```c
// AVX2 SIMD sum reduction over arr[lo..hi]
__m256i acc = _mm256_setzero_si256();
for (int i = lo; i + 8 <= hi; i += 8) {
    __m256i v = _mm256_loadu_si256((__m256i*)(arr + i));
    acc = _mm256_add_epi32(acc, v);
}
// horizontal reduce acc, then add tail elements
int sum = horizontal_sum_avx2(acc);
for (; i < hi; i++) sum += arr[i];
```

For range-min, replace `_mm256_add_epi32` with `_mm256_min_epi32`. For range-max use `_mm256_max_epi32`. AVX-512 supports `_mm512_reduce_min_epi32` natively.

**Real speedup**: 4–8x on partial-bucket scans, which constitute roughly 2B = 2√n of the query work. The full-middle aggregate sweep is already O(1) per bucket and harder to vectorize gainfully (the aggregates are spread out in memory).

In Java, use the **Vector API** (`jdk.incubator.vector`). In Go, hand-write assembly via `go:noescape` declarations or use the SVE2 intrinsics package. In Python, fall back to NumPy: `arr[lo:hi].sum()` calls into vectorized C and is usually 50x faster than a Python loop.

### 2.1 Reducing branch mispredictions

The trichotomy code:
```
if bl == br: ...
```
has unpredictable branching when query ranges are mixed-size. Two mitigations:
- Sort queries by `r - l` and batch same-size queries together (improves branch prediction).
- Use branchless code: compute both same-bucket and split-bucket paths and select via blend.

For most workloads neither is needed; the trichotomy branch is rarely on the hot path.

---

<a name="soa"></a>
## 3. Struct-of-Arrays for Bucket Aggregates

If each bucket holds multiple aggregates (sum, min, max, count), the naive **array-of-structs** layout:

```
struct Aggregate { long sum; long min; long max; int count; }
Aggregate buckets[NB];
```

Wastes cache lines when only one field is needed. A query for `range sum` reads `sum` of each bucket but pulls in the entire `Aggregate` struct (32+ bytes) per access.

**Struct-of-arrays** (SoA):
```
long bucketSum[NB];
long bucketMin[NB];
long bucketMax[NB];
int bucketCount[NB];
```

Now a range-sum query touches only `bucketSum[bl+1..br-1]` — densely packed in memory, prefetcher-friendly, possibly SIMD-reducible.

Trade-off: when you update a bucket, you write to multiple separate arrays instead of one struct. For workloads dominated by reads (typical), SoA wins. For write-heavy, AoS may win.

This is the same SoA pattern used by ECS game engines, columnar databases (ClickHouse, DuckDB), and SIMD-tuned numerical libraries.

---

<a name="parallel-mo"></a>
## 4. Parallelizing Mo's Algorithm

Mo's algorithm is sequential by nature — the window moves incrementally. But you can **parallelize across query blocks**:

- Sort queries by `(l / B, r)` as usual.
- Partition the sorted queries by `l/B` block.
- Assign each `l-block` to a worker thread.
- Each thread independently runs the sliding-window logic for queries in its block, starting fresh (its `curL, curR` are the block boundaries).

The catch: the thread must rebuild its window aggregate at the start of its block from scratch. This adds `O(B)` setup per thread, which is fine because there are `n/B` blocks each costing `O(B) = O(√n)` setup, totaling `O(n)` — absorbed into the existing `O(n √n)` work.

With `k` cores you get `~k×` speedup (Amdahl-limited by the largest block's work). On 16 cores, real-world 8–12× speedup is typical.

Other parallelization strategies:
- **Bucket-level parallelism inside one query**: the full-middle sum can be a parallel reduction. Useful only if the middle is very large.
- **Query batching**: process every 1000 queries by all available cores in parallel using the partition approach above.

---

<a name="hilbert"></a>
## 5. Hilbert-Curve Ordering — Implementation

The Hilbert curve is a space-filling fractal that visits every cell in an `N × N` grid such that consecutive cells are always adjacent. Using Hilbert order for Mo's queries minimizes total pointer motion in the `(l, r)` plane.

The Hilbert distance for cell `(x, y)` in an `N × N` grid (with `N` a power of 2) is computed in `O(log N)` bit operations:

```python
def hilbert_d(x, y, order):
    """Distance along the Hilbert curve of order `order` (grid size 2^order)."""
    rx = ry = 0
    d = 0
    s = (1 << order) // 2
    while s > 0:
        rx = 1 if (x & s) > 0 else 0
        ry = 1 if (y & s) > 0 else 0
        d += s * s * ((3 * rx) ^ ry)
        # rotate
        if ry == 0:
            if rx == 1:
                x = s - 1 - x
                y = s - 1 - y
            x, y = y, x
        s //= 2
    return d
```

Use as sort key:
```python
order = (n - 1).bit_length()
indexed.sort(key=lambda q: hilbert_d(q[0], q[1], order))
```

Empirically: 2–3× faster than `(l/B, r)` sort on typical `n = 10⁵` Mo problems, because consecutive queries cluster nearby in `(l, r)` space and the window moves less between them.

---

<a name="adaptive"></a>
## 6. Adaptive Block Sizing

For workloads where the array changes structurally (rare in pure sqrt-decomp, but common when sqrt-decomp is used as a building block for dynamic structures), you may need to **resize buckets** when:

- A bucket overflows: too many insertions push it above `2√n` elements. Split it.
- A bucket underflows: too many deletions shrink it below `√n / 2`. Merge with neighbor.

The classic technique: every `n` insertions/deletions, rebuild the entire structure from scratch in `O(n)`. Amortized: `O(1)` per update for the rebuild. Combined with `O(√n)` per individual operation, the structure handles dynamic sequences with `O(√n)` amortized per op including insertion/deletion in the middle — beating segment trees, which struggle with mid-sequence insertion.

This is used by Crit-bit trees, ropes (with bucket leaves), and dynamic-array balancing in functional languages.

### 6.1 Picking `B` from workload statistics

For a workload with `u` updates and `q` queries on a non-invertible aggregate, total cost ≈ `u·B + q·(B + n/B)`. Minimize:

```
d/dB = u + q - q·n/B² = 0
B = √(q·n / (u + q))
```

For balanced `u = q`: `B = √(n/2)`. For query-heavy (`q ≫ u`): `B → √n`. For update-heavy (`u ≫ q`): `B → 0` (i.e., minimize update cost; in practice clamp `B ≥ 1`, which effectively means linear scan for queries).

In production with measurable workload, you can profile actual `u` and `q` rates, set `B` accordingly, and adapt on the fly.

---

<a name="hierarchical"></a>
## 7. Hierarchical Bucketing (`√√n`)

Take sqrt-decomp's recursion to two levels:

- Level 0: array of size `n`.
- Level 1: `n^(3/4)` buckets of size `n^(1/4)`.
- Level 2: `n^(1/2)` super-buckets, each containing `n^(1/4)` level-1 buckets.

A range query touches at most:
- 2 partial level-1 buckets (`O(n^(1/4))` work),
- 2 partial level-2 super-buckets (`O(n^(1/4))` level-1 buckets, `O(n^(1/2))` total elements? No — only the aggregates),
- Full level-2 super-buckets via their precomputed aggregate (`O(√n)` of them, each `O(1)` to read).

Actually a cleaner two-level decomposition uses `B₁ = n^(1/3)` and `B₂ = n^(2/3)`: bucket of buckets. Query cost becomes `O(n^(1/3))`. Three-level decomp gives `O(n^(1/4))`. Pushing to `log n` levels: that's a segment tree.

In practice, two-level sqrt is rarely worth the code complexity over a segment tree, except for problems where the per-bucket aggregate is genuinely large (e.g., a frequency table over millions of possible values) and a segment tree node would be just as expensive.

### 7.1 The log-log trick

If `n = 2^(2^k)`, sqrt-decomp recursed `k` times gives `O(log log n)` per query — comparable to van Emde Boas trees. Used in algorithms for predecessor search and integer sorting (e.g., Andersson's results).

---

<a name="limits"></a>
## 8. Limits and When to Switch

### 8.1 When sqrt-decomp stops working

- **`n > 10⁸`**: even `O(√n) = 10⁴` per query is too slow for `q = 10⁶`. Switch to segment tree (`O(log n) ≈ 27` per query).
- **Persistence required**: persistent segment trees (`O(log n)` per update, `O(log n)` extra memory) beat persistent sqrt-decomp.
- **Concurrent updates from many threads**: a segment tree with fine-grained locking or lock-free reads scales better than buckets with coarse-grained per-bucket locks.
- **Heavy 2D / nD generalizations**: 2D segment trees and 2D BITs beat 2D sqrt-decomp for large grids.
- **Range updates + range queries on min/max**: sqrt-decomp with lazy works but is messy; lazy segment trees are cleaner.

### 8.2 When sqrt-decomp shines

- **Code under 50 lines**: contest, prototype, one-off analysis.
- **Non-invertible exotic aggregates** (mode, median, count distinct): segment trees can do this but need persistence or wavelet trees; sqrt-decomp + Mo is far simpler.
- **Heavy range updates** (range assign + range sum): cleaner than segment-tree lazy propagation.
- **Cache-tuned workloads** at `n ≤ 10⁶`: faster than segment tree in wall-clock.
- **2D static problems** (`n × n` grid, offline queries): blocking with `√n × √n` tiles + Mo-style sweep is competitive.

### 8.3 When you should switch to a database

For `n ≥ 10⁹`, in-memory sqrt-decomp / segment tree both fall apart. You want a columnar database (ClickHouse, DuckDB, Druid) with disk-resident block indexes — which internally use the same sqrt-decomp ideas at scale. Don't reinvent it; use the dependency.

---

<a name="further-reading"></a>
## 9. Further Reading

- **Intel Intrinsics Guide** — `_mm256_add_epi32`, `_mm512_reduce_min_epi32`, etc.
- **Andersson (1996)** — *"Faster Deterministic Sorting and Searching in Linear Space"*. The log-log result.
- **Goto & Geijn (2008)** — BLAS GEMM blocking and cache-tier sqrt-decomposition.
- **Codeforces blog by Mike Mirzayanov** — practical Hilbert-Mo benchmarks.
- **ClickHouse internals docs** — block-indexed columnar storage as production-scale sqrt-decomp.
- **Apache Druid segments documentation** — time-based bucketing in production OLAP.
- **Continue with**: `interview.md` and `tasks.md` for hands-on problem practice.
