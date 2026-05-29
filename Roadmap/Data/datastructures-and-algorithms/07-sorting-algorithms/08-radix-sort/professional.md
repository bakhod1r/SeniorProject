# Radix Sort — Mathematical Foundations and Complexity Theory

## Table of Contents
1. [Formal Definition](#formal-definition)
2. [Correctness Proof — Induction on Digit Passes](#correctness-proof)
3. [Lower Bound — Why the Comparison Bound Doesn't Apply](#lower-bound)
4. [I/O Complexity — External-Memory Model](#io-complexity)
5. [Parallel Work-Span Analysis](#parallel-work-span)
6. [Amortized and Average-Case Bounds](#amortized-analysis)
7. [Cache-Oblivious Analysis](#cache-oblivious)
8. [Comparison with Alternatives](#comparison)
9. [Summary](#summary)

---

## Formal Definition

```text
Let A = (a_1, a_2, ..., a_n) be a sequence of keys from a universe U.
Each key a_i is a d-digit string over a radix-k alphabet Σ_k = {0, 1, ..., k-1}:
    a_i = (a_i[d-1], a_i[d-2], ..., a_i[1], a_i[0])  (most → least significant)
        ≡ Σ_{j=0..d-1} a_i[j] · k^j

Total order on U: a < b iff there exists j ∈ {0,...,d-1} such that:
    a[d-1..j+1] = b[d-1..j+1]  and  a[j] < b[j].

Radix sort (LSD form): produces a permutation π of {1,...,n} such that
    a_{π(1)} ≤ a_{π(2)} ≤ ... ≤ a_{π(n)}
using d sequential applications of a stable inner sort S_j on digit j:
    A_{j+1} = S_j(A_j, key = a → a[j])
with A_0 = A and final A_d sorted.

S_j is stable: for any equal-keyed pair (a_i, a_l) at position j with i < l,
    π_j^{-1}(i) < π_j^{-1}(l) in the output of S_j.
```

The implementation uses Counting Sort as S_j: O(n + k) time, stable when the placement loop scans the input right-to-left and decrements the count array.

---

## Correctness Proof — Induction on Digit Passes

> **Theorem.** After d passes of LSD Radix Sort with a stable inner sort, the output is sorted by the lexicographic order on (a[d-1], ..., a[0]).

### Loop Invariant

```text
Invariant I(j):  After pass j (j ∈ {0, 1, ..., d}), the array is
                 sorted by the last j digits of every key:
                 ∀ i < l in the array: (a_i[j-1], ..., a_i[0]) ≤_{lex} (a_l[j-1], ..., a_l[0]).
```

### Base Case (j = 0)

Before any pass, "sorted by the last 0 digits" is vacuously true: there is no constraint to check. I(0) holds. ✓

### Inductive Step (assume I(j), prove I(j+1))

Pass j+1 applies a stable sort on digit position j (LSD-counted: position 0 = ones, position 1 = tens, ..., position d-1 = top digit). After the pass:

**Case A:** Two keys `a_i` and `a_l` with different digit at position j. WLOG `a_i[j] < a_l[j]`. The stable sort places all keys with digit-value `a_i[j]` before all keys with digit-value `a_l[j]`. So `a_i` precedes `a_l` in the output. Lex-order on `(a[j], ..., a[0])` is therefore correct for this pair. ✓

**Case B:** Two keys `a_i` and `a_l` with the **same** digit at position j: `a_i[j] = a_l[j]`. By I(j), in the input to this pass `a_i` and `a_l` are already in correct order on the last j digits. The stable sort preserves their relative order. So in the output `a_i` still precedes `a_l` (if it did before), and lex-order on `(a[j], a[j-1], ..., a[0])` is correct because:
- Top digit `a[j]` is equal → tie.
- Lower digits `(a[j-1], ..., a[0])` are in correct lex order by I(j).
∴ pair is in correct lex order. ✓

In both cases I(j+1) holds. ✓

### Termination

After d passes, all digits are exhausted. I(d) holds → the array is sorted by all d digits → the array is fully sorted in the universe's total order.

**QED.**

### What Breaks Without Stability

If the inner sort is unstable, Case B fails: two equal-digit keys can be reordered, destroying I(j). The induction breaks at the next iteration and final correctness is lost. This is why **Counting Sort** (not Quick Sort or Heap Sort) is the inner engine.

---

## Lower Bound

### Comparison Lower Bound Recap

Any comparison-based sort can be modeled as a binary decision tree where each internal node is a comparison `a_i ?< a_j` and each leaf is a permutation of the input. A correct sort must reach a distinct leaf for each of n! permutations. Therefore:

```text
tree height ≥ log₂(n!) = n log₂ n - n log₂ e + O(log n)
            ≈ n log₂ n - 1.44 n
```

→ Any comparison sort requires Ω(n log n) comparisons in the worst case.

### Why Radix Escapes

Radix Sort never executes a comparison `a_i ?< a_j`. Instead it executes operations of the form:

```text
digit_at(a_i, position)    // returns an integer in [0, k)
index_into(count, digit)   // O(1) array operation
```

The decision tree model is the wrong model. The right model is the **cell-probe model** with a bounded alphabet: each operation is "extract a digit, increment a counter, place in array." The lower bound for sorting in this model is `Ω(n)` (must read each input at least once) — and Radix Sort achieves this for fixed `d` and `k`.

### Formal Statement

```text
Theorem (lower bound for fixed-width integer sort):
    Sorting n keys in U = {0, ..., 2^w - 1} requires Ω(n) time
    in the word-RAM model with words of size w.

    Radix sort achieves O(n · w / log w) using word-level parallelism
    (Andersson et al., 1998 — "Sorting in linear time?"). For
    fixed w = O(log n), this is O(n).
```

→ Radix Sort is **asymptotically optimal** for word-RAM integer sort under reasonable models.

---

## I/O Complexity

The **external-memory model** (Aggarwal-Vitter, 1988) tracks block transfers between disk and a memory of size M, with block size B. The cost is the number of I/Os.

### Standard External Sort Lower Bound

```text
External sort lower bound: Ω( (N/B) · log_{M/B} (N/B) ) I/Os
```

This is the bound for sorting N records with M memory and B-record blocks.

### Radix Sort in External-Memory Model

**Two-phase external radix sort** (partition + recurse):

```text
Phase 1 — one pass over input:
    read N records (N/B reads)
    write to k bucket files (N/B writes, assuming B-aligned bucket files)
    cost: 2 · N/B I/Os

Phase 2 — sort each bucket:
    if bucket fits in M (size ≤ M):
        in-memory sort, no extra I/Os beyond loading the bucket (which was already counted above as scan)
    else:
        recurse: 2 · N/B more I/Os

Total passes: ceil(log_k(N/M)) where k is chosen so k · B ≤ M
    (k bucket files' buffers fit in memory).

Total I/O: O( (N/B) · log_k (N/M) )
         = O( (N/B) · log_{M/B} (N/M) )    [choosing k ≈ M/B]
         ≈ O( (N/B) · log_{M/B} (N/B) )    [for N ≫ M]
```

This **matches the external-memory sort lower bound** asymptotically. Radix sort is I/O-optimal for fixed-width integer keys.

### Worked Example: 1 TB, 16 GB memory, 4 KB blocks

```text
N = 2^40 / 8 = 1.37 × 10^11 records (8-byte ints)
M = 2^34 / 8 = 2.15 × 10^9 records
B = 2^12 / 8 = 512 records

N/M = 64
M/B = 2^22 = 4.2 million → k could be 4 million; in practice k = 256

log_256(64) = 0.75 → ceil = 1 pass
Total I/O: 1 partition pass × (2 × N/B) ≈ 5.5 × 10^8 I/Os
        + 1 in-memory pass over each bucket = 1 × N/B reads ≈ 2.7 × 10^8 I/Os
        ≈ 8 × 10^8 I/Os
```

On NVMe SSD at 1M IOPS sequential: ~800 seconds. Real-world implementations achieve ~5-10 minutes on a single high-end server.

---

## Parallel Work-Span Analysis

The **work-span model** (also called PRAM / DAG model) tracks:
- **Work `T_1`:** total operations across all processors (= sequential time).
- **Span `T_∞`:** length of the longest dependency chain (= parallel time on infinite processors).

Parallel runtime on p processors: `T_p ≥ T_1 / p + T_∞` (Brent's theorem).

### LSD Parallel Radix Sort

```text
Per pass:
    Histogram phase: parallel reduction, work O(n), span O(log n)
    Prefix-sum phase: parallel scan, work O(k), span O(log k)
    Scatter phase: each element knows its destination, work O(n), span O(1)
    Total per pass: work O(n + k), span O(log n + log k) = O(log n)

Across d passes (sequential dependency between passes):
    Total work T_1 = O(d · (n + k))
    Total span T_∞ = O(d · log n)

On p processors:
    T_p = O(d · (n + k) / p + d · log n)
```

For `d = O(1)` (fixed-width keys), this gives:

```text
T_p = O(n / p + log n)
```

→ Linear speedup up to `p = n / log n` processors. Beyond that, the log n span dominates.

### MSD Parallel Radix Sort

MSD's first partition has the same per-pass cost. After partition, each of the k buckets can be sorted in parallel:

```text
T_∞ for MSD: O((n+k) / k + T_∞ of largest bucket recursion)
           = O((n+k)/k · d) in the balanced case
           = O(n) in the worst case (one bucket gets all keys)
```

The balanced case gives near-perfect parallelism — but adversarial inputs force imbalance. **Sampling-based MSD** (sample input, partition by quantiles) restores balanced expected span.

### Bounded Memory Parallel

When memory is bounded to O(n) instead of O(n + p·k), the parallel scatter phase requires synchronization. **Wait-free** parallel radix sort uses per-thread output buffers + a final merge, costing extra O(p · n) work but maintaining O(log n) span.

---

## Amortized Analysis

Radix Sort is **not** an amortized algorithm — the cost is paid up-front, not deferred. There is no notion of cheap-vs-expensive operations like for splay trees or dynamic arrays. The worst-case `O(d · (n + k))` is also the average and amortized.

However, the **partial sort** variant — sort only enough to find the top-K — has an amortized analysis worth noting:

```text
Top-K with MSD radix:
    Pass 1: O(n + k) → identify top buckets containing all K winners
    Recurse only into top buckets: total size = K
    Pass 2..d: O(K log K) (insertion sort on small buckets)

Amortized cost per top element: O(n/K + log K)
```

This is the basis of **partial sort** in NumPy (`np.partition`), which uses introselect (median-of-medians + radix-like partition).

### Replacement-Selection Run Generation

For **external** radix-style sort, the analogous trick: **replacement selection** generates runs of average length 2M instead of M. The amortized analysis uses a snowplow argument (Knuth TAOCP Vol. 3, §5.4.1):

```text
Expected run length under random input ≈ 2M
Number of runs ≈ N / (2M) vs N/M for simple sort-then-write
→ Halves the number of files to merge → log_k(N/M) passes halves
```

---

## Cache-Oblivious Analysis

The **cache-oblivious model** (Frigo et al., 1999) assumes the algorithm doesn't know cache size M or block size B, yet must still achieve optimal cache complexity.

### Standard Radix Sort Is NOT Cache-Oblivious

Standard LSD Radix Sort chooses radix k = 256 explicitly. This requires knowing the cache size to pick k. Therefore the algorithm is **cache-aware**, not cache-oblivious.

### Funnel Sort — The Cache-Oblivious Alternative

For optimal cache complexity on unknown architectures, **funnel sort** (Frigo et al., 2012) achieves:

```text
Cache complexity: O( (N/B) · log_{M/B} (N/B) ) without knowing M or B
```

This matches external sort's lower bound. Funnel sort is comparison-based (merge variant); the cache-oblivious analog for radix doesn't easily exist because radix's per-pass scatter is fundamentally tied to a fixed bucket count.

### Hybrid Cache-Aware Radix

In practice, cache-aware radix dominates: detect L1/L2/L3 size at startup, pick `k` accordingly, switch radix between passes if cache pressure changes. Used by DuckDB and Velox.

```text
For each pass:
    If output fits in L1 (n · key_size < 32 KB):
        radix = 256
    Else if output fits in L2 (n · key_size < 256 KB):
        radix = 256 with software write-combining
    Else if output fits in L3 (n · key_size < 16 MB):
        radix = 256 with prefetch
    Else (out of L3):
        MSD partition first to drop into L3, then LSD
```

---

## Comparison with Alternatives

| Attribute | Radix (LSD, k=256) | Merge Sort | Quick Sort | Counting Sort |
|-----------|--------------------|------------|------------|---------------|
| Worst-case time | O(d · (n + k)) | O(n log n) | O(n²) | O(n + k) |
| Cache I/Os (external) | O((N/B) · log_{M/B}(N/B)) | O((N/B) · log_{M/B}(N/B)) | O((N/B) · log_{M/B}(N/B)) avg | O(N/B) |
| Work-span span | O(d · log n) | O(log² n) | O(n) worst, O(log² n) average | O(log n) |
| Deterministic? | Yes | Yes | No (randomized pivots) | Yes |
| Stable | Yes (LSD) | Yes | No (typical) | Yes |
| In-place | No | No | Yes (variants) | No |
| Comparison-based | No | Yes | Yes | No |
| Achieves Ω(n) lower bound? | Yes (for fixed d, k) | No (Ω(n log n)) | No | Yes |
| Word-RAM optimal | Yes | No | No | Yes |

### Sorting Algorithm Selection Theorem (Informal)

```text
For comparison-based input:
    No algorithm beats Ω(n log n) → Tim Sort / Pdqsort / Merge Sort.

For integer input with key width w:
    If w = O(log n):  Radix Sort = O(n) optimal.
    If w = ω(log n):  Pdqsort or radix; depends on constants.
    If keys fit in O(1) bits: Counting Sort = O(n + k).

For external memory:
    Radix or Merge achieves O((N/B) log_{M/B}(N/B)) — both optimal.

For parallel (work-span):
    Radix achieves O(n / p + d · log n).
    Sample sort / parallel merge achieves O(n log n / p + log² n).
```

---

## Summary

At the professional level, Radix Sort is **provably optimal** within the right computational models:

1. **Correctness:** induction on digit passes, with stability of the inner sort as the critical hypothesis. The proof breaks if you swap stable Counting Sort for an unstable inner sort.
2. **Lower bound:** the Ω(n log n) comparison bound doesn't apply because Radix Sort uses cell-probe / word-RAM operations, not comparisons. The relevant lower bound is Ω(n) for reading the input, achieved by Radix.
3. **I/O complexity:** matches the external-memory sorting lower bound O((N/B) log_{M/B}(N/B)) using cache-aware bucket partitioning.
4. **Parallel:** O(n/p + d log n) span, near-linear speedup for fixed d.
5. **Cache-oblivious:** does not achieve cache-obliviousness; cache-aware tuning required. Funnel sort is the cache-oblivious alternative.

The algorithm is the canonical example of how to **escape a lower bound by changing the computational model**. The comparison model is too restrictive for integer keys; the word-RAM model with bounded-width digits admits the Ω(n) algorithm that Radix Sort achieves.

In practice, this theory translates into the design rule: **choose radix to fit the cache, choose pass count to match key width, use sampling for distributed range partition, use stable Counting Sort as the inner engine**. Every production radix sort, from CUB to PostgreSQL's vectorized executor, follows this template.
