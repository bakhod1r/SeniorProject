# Binary Search — Professional Level

> **Audience:** Algorithm designers, performance engineers, and researchers. Prerequisites: discrete math (logarithms, ceilings/floors), basic asymptotic analysis, comfort with cache hierarchies.

This document gives the **formal mathematical treatment** of binary search: a precise definition, a correctness proof via loop invariants, the **exact** comparison count `⌈log₂(n + 1)⌉`, the matching information-theoretic lower bound `Ω(log n)` for any comparison-based search on sorted data, the **cache complexity** O(log n) misses analysis (Frigo et al.), and the **Eytzinger layout** that beats classical binary search by a constant factor of 2–4× on cache-bound workloads.

---

## Table of Contents

1. [Formal Definition](#definition)
2. [Correctness Proof via Loop Invariants](#correctness)
3. [Exact Comparison Count `⌈log₂(n + 1)⌉`](#comparison-count)
4. [Tight Lower Bound `Ω(log n)`](#lower-bound)
5. [Cache Complexity O(log n) Misses](#cache-complexity)
6. [Eytzinger Layout for Cache-Friendly Binary Search](#eytzinger)

---

<a name="definition"></a>
## 1. Formal Definition

### Problem

Let `A = [a_0, a_1, …, a_{n-1}]` be a sequence of `n` elements drawn from a totally ordered set `(S, ≤)`, sorted such that `a_i ≤ a_{i+1}` for all `0 ≤ i < n - 1`. Given a query `t ∈ S`, the **search problem** is to determine whether `t ∈ A` and, if so, return an index `i` such that `a_i = t`. Variants include:

- **Exact search.** Return any `i` with `a_i = t`, or `⊥` (not present).
- **Lower bound.** Return `min{i : a_i ≥ t}` (or `n` if no such `i`).
- **Upper bound.** Return `min{i : a_i > t}` (or `n`).
- **Predicate boundary.** Given a monotonic predicate `p : {0, …, n-1} → {⊥, ⊤}`, return `min{i : p(i) = ⊤}`.

### Binary search as a procedure

```
function BSearch(A, t):
    lo ← 0
    hi ← n
    while lo < hi:
        mid ← lo + ⌊(hi - lo) / 2⌋
        if A[mid] < t: lo ← mid + 1
        else:          hi ← mid
    return lo               // lower-bound semantics
```

This is the half-open `[lo, hi)` form. For exact search, post-process: `return lo if lo < n ∧ A[lo] = t else ⊥`.

### Information-theoretic framing

There are `n + 1` possible **outcomes** for an exact search: indices `0, 1, …, n - 1`, plus "not present". Each three-way comparison `A[mid] vs t` extracts at most `log₂ 3 ≈ 1.58` bits of information. Thus the **information lower bound** is `⌈log₃(n + 1)⌉` three-way comparisons.

But **binary search uses two-way comparisons** (it branches into "left half" or "right-half-or-mid" — two outcomes per probe, since equality is detected as a special case of one of the branches). With two-way comparisons, the lower bound becomes `⌈log₂(n + 1)⌉`. Binary search achieves this bound up to ±1.

---

<a name="correctness"></a>
## 2. Correctness Proof via Loop Invariants

We prove the lower-bound variant. Let `L(A, t) := min{i ∈ [0, n] : i = n ∨ A[i] ≥ t}` — the lower-bound function we wish to compute.

### The invariant

> **(I)** At the top of every iteration, `0 ≤ lo ≤ L(A, t) ≤ hi ≤ n`.

Equivalently: every index `< lo` has `A[i] < t`, and the index `hi` (if `hi < n`) has `A[hi] ≥ t`. The desired answer lies in `[lo, hi]`.

### Proof of (I)

**Initialization.** Before the first iteration, `lo = 0` and `hi = n`. Trivially `0 ≤ L(A, t) ≤ n`.

**Maintenance.** Assume (I) holds at the top of an iteration with `lo < hi`. Compute `mid = lo + ⌊(hi - lo)/2⌋`. Note `lo ≤ mid < hi` (because `(hi - lo) ≥ 1` implies `⌊(hi - lo)/2⌋ < hi - lo`).

- **Case 1:** `A[mid] < t`. Then no index `≤ mid` satisfies `A[i] ≥ t`, so `L(A, t) > mid`, i.e., `L(A, t) ≥ mid + 1`. We set `lo ← mid + 1`. The new `lo ≤ L(A, t) ≤ hi` (unchanged), so (I) holds.
- **Case 2:** `A[mid] ≥ t`. Then `mid` is a candidate for `L(A, t)`, so `L(A, t) ≤ mid`. We set `hi ← mid`. The new `hi = mid ≥ L(A, t)`, and `lo` (unchanged) `≤ L(A, t)`, so (I) holds.

**Termination.** Each iteration strictly decreases `hi - lo` (in case 1, `lo` increases by `mid - lo + 1 ≥ 1`; in case 2, `hi` decreases by `hi - mid ≥ 1`). Since `hi - lo` is a non-negative integer, the loop terminates after at most `n` iterations (in fact, after `⌈log₂(n + 1)⌉` — see §3).

**Postcondition.** When the loop exits, `lo = hi`, and by (I), `lo = L(A, t)`. ∎

### A subtle point about `mid`

The choice `mid = lo + ⌊(hi - lo)/2⌋` is the standard one, but `mid = lo + ⌈(hi - lo)/2⌉` also works *if you swap which branch shrinks `hi` to `mid`*. The point: you need `lo ≤ mid < hi` (or `lo < mid ≤ hi`, depending on convention). If you accidentally write `mid` such that `mid = hi` and then `hi ← mid`, the loop never terminates.

### Why proofs matter

Binary search is the textbook example of an algorithm that's **easy to write incorrectly**. Bentley reported in *Programming Pearls* (1986) that of >100 professional programmers asked to write binary search, **fewer than 10% submitted a correct version on first try**. The loop invariant proof is the only reliable way to verify correctness: if you can state and check (I) at every line, you cannot have an off-by-one bug.

---

<a name="comparison-count"></a>
## 3. Exact Comparison Count `⌈log₂(n + 1)⌉`

### Claim

Binary search on a sorted array of `n` elements performs **at most `⌈log₂(n + 1)⌉`** two-way comparisons in the worst case, and this is tight.

### Proof of upper bound

Each iteration reduces the search window size from `s = hi - lo` to:
- `s - ⌊s/2⌋ - 1 = ⌈s/2⌉ - 1` in case 1 (`lo ← mid + 1`)
- `⌊s/2⌋` in case 2 (`hi ← mid`)

Both are at most `⌊s/2⌋` (since `⌈s/2⌉ - 1 ≤ ⌊s/2⌋`). Wait — actually `⌈s/2⌉ - 1 ≤ ⌊s/2⌋ - 1 + 1 = ⌊s/2⌋` only when `s` is even; for odd `s`, `⌈s/2⌉ - 1 = (s + 1)/2 - 1 = (s - 1)/2 = ⌊s/2⌋`. So in both parities the new size is ≤ `⌊s/2⌋`. Wait, for odd `s = 2k+1`, case 1 yields `⌈s/2⌉ - 1 = k+1 - 1 = k = ⌊s/2⌋`, case 2 yields `⌊s/2⌋ = k`. Equal.

For even `s = 2k`, case 1 yields `⌈s/2⌉ - 1 = k - 1`, case 2 yields `k`. Case 2 is the worse (larger remaining size). So the worst-case shrinkage is from `s` to `⌊s/2⌋`.

Starting at `s = n`, after `k` iterations the size is at most `⌊n / 2^k⌋`. The loop continues while size > 0, so the maximum number of iterations is the smallest `k` with `⌊n / 2^k⌋ = 0`, i.e., `2^k > n`, i.e., `k > log₂ n`, i.e., `k = ⌊log₂ n⌋ + 1 = ⌈log₂(n + 1)⌉`.

### Proof of lower bound (matching)

Information-theoretically, binary search must distinguish among `n + 1` outcomes (`n` indices + "not present"). A binary decision tree distinguishing `n + 1` outcomes has depth at least `⌈log₂(n + 1)⌉`. ∎

### Concrete numbers

| `n` | `⌈log₂(n + 1)⌉` |
|---|---|
| 1 | 1 |
| 7 | 3 |
| 15 | 4 |
| 100 | 7 |
| 1,000 | 10 |
| 1,000,000 | 20 |
| 1,000,000,000 | 30 |
| `2^64 - 1` | 64 |

A binary search over the entire 64-bit address space takes 64 comparisons. This is why `slices.BinarySearch` in Go is constant-time for all practical purposes — the iteration count is bounded by hardware word size.

---

<a name="lower-bound"></a>
## 4. Tight Lower Bound `Ω(log n)`

### Theorem (Yao, 1976)

Any algorithm that searches a sorted array of `n` distinct comparable elements using only **two-way comparisons** between the query and array elements requires `Ω(log n)` comparisons in the worst case.

### Proof sketch (decision tree argument)

Consider the decision tree of any deterministic search algorithm. Each internal node is a comparison `t vs A[i]` for some `i`, with two children (one per outcome). Each leaf corresponds to one possible answer (one of `n + 1` outcomes: an index, or "not present").

A binary tree with `n + 1` leaves has depth at least `⌈log₂(n + 1)⌉`. Therefore the algorithm makes at least `⌈log₂(n + 1)⌉ = Ω(log n)` comparisons in the worst case (the path to the deepest leaf). ∎

### Implications

- **Binary search is optimal** among comparison-based search algorithms on sorted arrays.
- To beat `Ω(log n)`, you must abandon comparison-based access. Hash tables (O(1)) and interpolation search on uniform data (O(log log n)) both do exactly this — hash tables compute an address from the key bits, interpolation guesses a position from the value distribution.
- The bound is **per query**. Amortized faster bounds (e.g., `O(log log n)` for fractional cascading across many sorted lists) require preprocessing but each individual query still respects the comparison lower bound for that particular sorted list.

### Stronger lower bound: even with random hints

Even **randomized** comparison-based search has expected `Ω(log n)` queries. The decision-tree argument generalizes: a randomized algorithm is a probability distribution over deterministic decision trees, each of which has depth `Ω(log n)`, so the expected depth is `Ω(log n)`.

---

<a name="cache-complexity"></a>
## 5. Cache Complexity O(log n) Misses

The standard RAM model treats every memory access as O(1). On real hardware, **memory access cost depends on the cache hierarchy**. We now analyze binary search in the **external-memory model** (Aggarwal & Vitter, 1988) and **cache-oblivious model** (Frigo et al., 1999).

### Setup

- Cache holds `M` elements, organized in lines (blocks) of `B` elements each, so `M/B` lines fit in cache.
- A cache **miss** transfers one block of `B` elements from main memory.
- A cache **hit** is free.

### Naive binary search analysis

Each probe at index `mid` touches `A[mid]`. For large `n`, consecutive `mid` values are roughly `n/2, n/4, n/8, …`, all far apart in memory. After `log₂(M/B)` probes, the search window shrinks below cache-line granularity, and remaining probes hit cache.

So the cache-miss count is approximately:

```
log₂ n - log₂(M/B) = log₂(n B / M)   misses
```

For `n = 10^9` (4 GB of int32), `B = 64 bytes = 16 ints`, `M = 32 MB = 8 × 10^6 ints` (typical L3): `log₂(10^9 × 16 / 8 × 10^6) ≈ log₂(2000) ≈ 11` misses. Each miss is ~100 ns from DRAM, so binary search costs ~1.1 µs.

For `n = 10^6` (4 MB, fits in L2): essentially zero L2-to-L3 misses; runs from L2 in ~50 ns.

### The pathology

Above L3 size, every probe in the first `log₂(n B / M)` iterations is a near-guaranteed cache miss because the strides are larger than any prefetcher predicts. The **CPU stalls** waiting for memory. This is why binary search on a 100 GB sorted file is much slower than the asymptotic O(log n) suggests — the constant factor is dominated by DRAM latency.

### B-trees beat binary search on cache complexity

A B-tree with node size `B` has depth `log_B n`, and each node fits in one cache line. So each level of the B-tree costs **one** cache miss, and the total is `O(log_B n)` misses — much smaller than `O(log₂ n)` when `B` is large.

For `n = 10^9`, `B = 64`: `log₆₄(10^9) ≈ 5` misses. Vs. binary search's 11 misses. **B-trees are ~2× faster** than sorted arrays at this scale, purely because of cache locality.

This is **the** reason database indexes use B-trees rather than sorted arrays.

### Cache-oblivious binary search

The cache-oblivious model demands O(log_B n) cache misses **without** knowing `B` at design time. Achieved by the **van Emde Boas layout** (or equivalently for binary search, the Eytzinger layout — see §6). The result: the same code is asymptotically optimal for any cache hierarchy.

---

<a name="eytzinger"></a>
## 6. Eytzinger Layout for Cache-Friendly Binary Search

The **Eytzinger layout** (also called BFS layout, or Eytzinger order, after the genealogist Michael Eytzinger who used it to number ancestors in 1590) reorders a sorted array so that **binary search probes hit sequential cache lines** instead of jumping by halves through memory.

### The layout

Given a sorted array `S` of `n` elements (1-indexed), build `E` of size `n + 1` (also 1-indexed) where `E[1]` is the root of the implicit binary search tree, `E[2k]` is its left child, `E[2k+1]` is its right child:

```
function buildEytzinger(S, E, i = 1, k = 1):
    if k > n: return i
    i ← buildEytzinger(S, E, i, 2k)         # build left subtree
    E[k] ← S[i]; i ← i + 1                 # current node
    return buildEytzinger(S, E, i, 2k + 1)  # build right subtree
```

This places the in-order traversal of a balanced BST into a contiguous array indexed by BFS order.

### Search

```
function eytzingerSearch(E, n, t):
    k ← 1
    while k ≤ n:
        if E[k] < t: k ← 2k + 1
        else:        k ← 2k
    k ← k >> ffs(~k)         // find lower bound; ffs = find first set
    return k
```

Or equivalently, use a "ghost element" sentinel approach. The key property: each iteration reads `E[k]` then `E[2k]` or `E[2k+1]` — these are at most one cache line apart for small `k` and predictable for large `k`, **and prefetching works**.

### Why it's faster

The hardware prefetcher loads `E[2k]` and `E[2k+1]` together (they're adjacent in memory), so by the time you finish comparing `E[k]`, both children are already in cache. Each iteration costs ~1 cycle in the steady state instead of ~10–100 cycles waiting for memory.

### Benchmarks (typical, x86-64 with 256 KB L2)

| `n` | Sorted array binary search | Eytzinger | Speedup |
|---|---|---|---|
| 10³ (4 KB) | 8 ns | 7 ns | 1.1× |
| 10⁵ (400 KB) | 30 ns | 18 ns | 1.7× |
| 10⁷ (40 MB) | 230 ns | 80 ns | 2.9× |
| 10⁹ (4 GB) | 800 ns | 250 ns | 3.2× |

Numbers from Khuong & Morin, "Array Layouts for Comparison-Based Searching" (2017) — the reference benchmark paper. They also evaluate B-tree-of-arrays and Sleator-Tarjan splay layouts; Eytzinger wins on lookup-heavy workloads.

### Costs of Eytzinger

- **Build is O(n)** but more cache-thrashing than just sorting.
- **Insertion is O(n)** (you must rebuild). Worse than the O(n) of a sorted array because of indirection.
- **Predecessor / successor queries** require a clever bit-twiddling trick (the `k >> ffs(~k)` line above) — easy to get wrong.
- **Range queries** are awkward (the leaves are in a strange order).

### When to use Eytzinger

- Read-only, lookup-heavy workloads where the array doesn't fit in cache.
- Embedded keys in bloom-filter-like structures where you're already doing bit twiddling.
- Static lookup tables built once at server startup.

For workloads with frequent updates or range queries, **B-trees are still the right answer** — they handle insertions in O(log n) and support range scans naturally.

### Beyond Eytzinger: van Emde Boas layout

The van Emde Boas (vEB) layout recursively partitions a balanced BST into top and bottom halves of `√n` size each, laying out each recursively in vEB order. This gives **cache-oblivious O(log_B n)** misses — optimal for any cache size.

vEB outperforms Eytzinger only at extreme sizes (multi-TB datasets, multi-level cache hierarchies). For most workloads, Eytzinger's simpler implementation and similar performance make it the practical choice.

---

## Summary of Bounds

| Quantity | Value |
|---|---|
| Worst-case comparisons | `⌈log₂(n + 1)⌉` |
| Average-case comparisons (uniform `t`) | `log₂ n − 1 + 1/n` |
| Comparison lower bound (any algorithm) | `⌈log₂(n + 1)⌉` |
| Cache misses (RAM model `M`, line `B`) | `Θ(log₂(nB/M))` for sorted array |
| Cache misses (B-tree, fanout `B`) | `Θ(log_B n)` |
| Cache misses (Eytzinger, large `n`) | `Θ(log_B n)` constant-factor better than sorted array |
| Iterative space | `O(1)` |
| Recursive space | `O(log n)` |

These bounds are **tight** in the comparison model. To go faster, you must use the structure of the keys (hash, interpolation), the cache hierarchy (B-tree, Eytzinger), or batch many queries together (fractional cascading, parallel SIMD search).

---

## Further Reading

- **Knuth TAOCP v3**, §6.2.1 — comparison-count analysis, average-case formulas, decision-tree depth.
- **Yao**, "Probabilistic Computations: Toward a Unified Measure of Complexity" (1977) — randomized lower bound.
- **Aggarwal & Vitter**, "The Input/Output Complexity of Sorting and Related Problems" (1988) — external-memory model.
- **Frigo, Leiserson, Prokop, Ramachandran**, "Cache-Oblivious Algorithms" (1999) — cache-oblivious framework.
- **Khuong & Morin**, "Array Layouts for Comparison-Based Searching" (2017) — the definitive Eytzinger benchmark and analysis. Open access at arXiv:1509.05053.
- **Sedgewick & Wayne**, *Algorithms* 4e, §3.1 — average-case analysis of binary search trees, related to BST layouts.
