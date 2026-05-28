# Heap Sort — Professional Level

> **Audience:** computer scientists, library authors, and engineers who need rigorous proofs and exact bounds. We formalize the heap invariant, prove correctness of `siftDown`, prove `O(n)` build-heap via geometric series, derive the exact comparison count `~2n log₂ n`, analyze cache complexity, discuss the parallel difficulty, and confirm Heap Sort matches the comparison-sort lower bound.

---

## Table of Contents

1. [Formal Definitions](#formal-definitions)
2. [Correctness Proof of `siftDown`](#correctness-proof-of-siftdown)
3. [Correctness Proof of Heap Sort](#correctness-proof-of-heap-sort)
4. [Build-Heap Is Θ(n) — Tight Proof](#build-heap-is-n-tight-proof)
5. Comparison Count: Exact ~2n log₂ n
6. [Cache Complexity: Why It's Slow in Practice](#cache-complexity-why-its-slow-in-practice)
7. [Parallel Heap Sort Is Hard](#parallel-heap-sort-is-hard)
8. [Lower Bound for Comparison Sorting](#lower-bound-for-comparison-sorting)
9. [Heap Sort vs Information-Theoretic Optimum](#heap-sort-vs-information-theoretic-optimum)
10. [Summary](#summary)

---

## Formal Definitions

### Definition 1 — Complete Binary Tree (Array form)

An array `A[0..n-1]` represents a **complete binary tree** of `n` nodes where:

- The root is at index `0`.
- For each `i ∈ {0, 1, ..., n-1}`:
  - `parent(i) = ⌊(i - 1) / 2⌋` if `i > 0`.
  - `left(i) = 2i + 1`.
  - `right(i) = 2i + 2`.
- A node at index `i` exists iff `0 ≤ i < n`.

This represents a tree where all levels are full except possibly the last, which is filled left-to-right.

### Definition 2 — Max-Heap Property

`A[0..n-1]` satisfies the **max-heap property** if for all `i ∈ {1, 2, ..., n-1}`:

```
A[parent(i)] ≥ A[i]
```

Equivalently: for all `i ∈ {0, ..., ⌊n/2⌋ - 1}`:

```
A[i] ≥ A[2i + 1]               (left child if exists)
A[i] ≥ A[2i + 2]               (right child if exists)
```

### Definition 3 — Subtree Heap

`SubtreeHeap(A, i, n)` is the property that the subtree of `A[0..n-1]` rooted at index `i` satisfies the max-heap property: for every `j` in the subtree of `i`, if `parent(j) ≠ ∅` and `parent(j)` is also in the subtree, then `A[parent(j)] ≥ A[j]`.

### Definition 4 — Tree Height

The **height** of a node `i` in `A[0..n-1]` is the number of edges on the longest path from `i` to a leaf in its subtree.

The height of the heap is the height of the root, denoted `h(n) = ⌊log₂ n⌋`.

The number of nodes at height `h` is at most `⌈n / 2^(h+1)⌉`.

---

## Correctness Proof of `siftDown`

```
siftDown(A, i, n):
    while 2i + 1 < n:
        L := 2i + 1
        R := 2i + 2
        largest := i
        if L < n and A[L] > A[largest]: largest := L
        if R < n and A[R] > A[largest]: largest := R
        if largest = i: return
        swap(A, i, largest)
        i := largest
```

### Theorem 1 (siftDown correctness)

**Hypothesis.** Before the call `siftDown(A, i, n)`:
1. The left and right subtrees of `i` (if they exist) satisfy the max-heap property.
2. `A[i]` may be smaller than its children.

**Conclusion.** After the call, the subtree rooted at `i` satisfies the max-heap property, and the multiset of values in that subtree is unchanged.

### Proof

**Loop invariant:** at the start of each iteration, the subtrees of every descendant of `i` *other than the path from the original `i` to the current position* satisfy the max-heap property, and the value originally at the input `i` is currently at the position `i` (the loop variable).

**Initialization:** before the first iteration, both subtrees of `i` are heaps (hypothesis 1), and `A[i]` is the original value. Trivially true.

**Maintenance:** at each iteration, we identify the largest of `{A[i], A[L], A[R]}`. Three cases:

- **Case A:** `largest = i`. We `return`. The subtree is now a heap because `A[i]` dominates both children (which are roots of heaps).
- **Case B:** `largest = L`. We swap, and recurse on `L` (set `i := L`). After the swap, `A[L]` (now the old `A[i]`) needs to be re-sifted, but the right subtree of the original `i` is untouched and still a heap, and the new root `A[i]` (= old `A[L]`) ≥ old `A[L]`'s siblings (which are unchanged) by the original sub-heap property. So the only violation is at the new position.
- **Case C:** `largest = R`. Symmetric.

**Termination:** each iteration strictly increases `i` (since we go to a child). The loop ends when `2i + 1 ≥ n` (leaf) or `largest = i`. Either way it terminates in at most `h(i) + 1` iterations where `h(i)` is the height of node `i`.

**Postcondition:** when the loop exits, the entire subtree rooted at the original `i` is a heap (by maintenance + termination). The multiset is unchanged because the only modification is swapping. ∎

### Corollary

`siftDown(A, i, n)` runs in `O(h(i)) ⊆ O(log n)` time and uses `O(1)` extra space.

---

## Correctness Proof of Heap Sort

```
heapSort(A):
    n := len(A)
    for i := n/2 - 1 down to 0:        // build phase
        siftDown(A, i, n)
    for end := n - 1 down to 1:        // extract phase
        swap(A, 0, end)
        siftDown(A, 0, end)
```

### Theorem 2 (Heap Sort correctness)

After `heapSort(A)` completes, `A` is sorted in non-decreasing order, and the multiset of values is unchanged.

### Proof

**Phase 1 — build invariant.** After the build loop completes, `A[0..n-1]` is a max-heap.

By induction on `i` going from `n/2 - 1` down to `0`. Base case `i = n/2 - 1`: the children of `i` are leaves at indices `≥ n/2`, so they are trivially heaps (a single node is a heap). After `siftDown(A, i, n)`, the subtree of `i` is a heap (Theorem 1). Inductive step: assume the subtrees of all `j > i` are heaps. The children of `i` are at indices `2i + 1 > i` and `2i + 2 > i`, so by IH they are heaps. After `siftDown(A, i, n)`, the subtree of `i` is a heap (Theorem 1). When `i = 0`, the entire array is a heap.

**Phase 2 — extract invariant.** Maintain the invariant that at the start of each iteration of the extract loop:
1. `A[0..end]` is a max-heap (where `end+1` is the current heap size).
2. `A[end+1..n-1]` is sorted in non-decreasing order.
3. `min(A[end+1..n-1]) ≥ max(A[0..end])`.

**Initialization:** `end = n - 1`, the heap is the whole array, the sorted region is empty. Conditions hold vacuously.

**Maintenance:** at each iteration, `swap(A, 0, end)`. After swap:
- `A[end]` holds the previous max of `A[0..end]`, which is ≥ everything else in `A[0..end-1]` (heap property). So `A[end] ≥ max(A[0..end-1])` and (by IH condition 3) `A[end] ≤ min(A[end+1..n-1])`. So `A[end..n-1]` is sorted. ✓
- The element previously at `A[end]` is now at `A[0]`. The subtrees of `0` (rooted at 1 and 2) are still heaps (we only touched index `0` and `end`, and `end > 2` for `n > 3`; for `n ≤ 3` it's trivial). So `siftDown(A, 0, end)` makes `A[0..end-1]` a heap (Theorem 1).
- After decrementing `end`, condition 1 holds for the new `end`.

**Termination:** when `end = 0`, the heap is `A[0..0]` (one element, trivially a heap), and `A[1..n-1]` is sorted. By condition 3, `A[0] ≤ A[1]`. So `A[0..n-1]` is sorted. ∎

---

## Build-Heap Is Θ(n) — Tight Proof

### Theorem 3 (Build-heap complexity)

Floyd's bottom-up build-heap on an array of `n` elements runs in `Θ(n)` time.

### Proof

The total work is

```
T(n) = Σ (cost of siftDown(A, i, n))   for i = 0 to ⌊n/2⌋ - 1
```

Each `siftDown` from a node at height `h` does at most `c · h` comparisons for some constant `c > 0`. The number of nodes at height `h` is at most `⌈n / 2^(h+1)⌉`.

So

```
T(n) ≤ Σ ⌈n / 2^(h+1)⌉ · c · h        for h = 0 to ⌊log₂ n⌋
     ≤ c · n/2 · Σ h / 2^h            for h = 0 to ∞
```

The series `S = Σ h / 2^h` converges. We compute it:

```
S    = 0/1 + 1/2 + 2/4 + 3/8 + 4/16 + ...
2S   = 0   + 1    + 2/2 + 3/4 + 4/8  + 5/16 + ...
2S - S = 1 + 2/2 - 1/2 + 3/4 - 2/4 + 4/8 - 3/8 + ...
       = 1 + 1/2 + 1/4 + 1/8 + ... = 2
```

So `S = 2`. Therefore

```
T(n) ≤ c · n/2 · 2 = c · n = O(n).
```

For the lower bound: the build loop performs `⌊n/2⌋` calls, each with at least one comparison if the node is internal, so `T(n) ≥ ⌊n/2⌋ = Ω(n)`.

Combined: `T(n) = Θ(n)`. ∎

### Remark

This proof shows that the apparent `O(n log n)` upper bound `(n/2) · log n` is loose because **most nodes are shallow**. Half the nodes are leaves (`h = 0`), a quarter have `h = 1`, an eighth `h = 2`, etc. The expected height of a random node is `O(1)`, not `O(log n)`.

---

## Comparison Count: Exact ~2n log₂ n

### Theorem 4 (Comparison count for Heap Sort)

The total number of element comparisons performed by Heap Sort on an array of `n` elements is

```
C(n) = 2n log₂ n + O(n)
```

with the leading constant `2` arising because each `siftDown` step does **two** comparisons (one against the left child to find the larger sibling, one against the larger child to decide whether to swap).

### Derivation

**Phase 1 (build):** total comparisons are `Θ(n)` by Theorem 3, with a constant of at most 2 per sift-down step.

**Phase 2 (extract):** there are `n - 1` extractions. The `k`-th extraction does a `siftDown` on a heap of size `n - k`, which has height `⌊log₂(n - k)⌋`. The work per sift-down is at most `2 · ⌊log₂(n - k)⌋` comparisons.

Total Phase 2 comparisons:

```
Σ 2 · ⌊log₂(n - k)⌋        for k = 1 to n - 1
≈ 2 · Σ log₂ k             for k = 1 to n
= 2 · log₂(n!)
```

By Stirling's approximation:

```
log₂(n!) = n log₂ n - n / ln(2) + O(log n) = n log₂ n - 1.4427 n + O(log n)
```

So Phase 2 = `2n log₂ n - 2.88 n + O(log n)`.

Combined: `C(n) = 2n log₂ n + O(n)`. ∎

### Refined: bottom-up sift-down cuts comparisons in half

Wegener's bottom-up sift-down (1993) traces the path of largest children **without comparing the sift target** — one comparison per level. Then it sifts up to find the right insertion point on this path. Total comparisons: `n log₂ n + O(n log log n)` — half the constant.

In practice, this 2× improvement in comparisons translates to ~10–15% wall-clock speedup, since comparison cost is only part of the work (memory accesses dominate).

### Comparison with other sorts

| Algorithm | Comparison count (avg) |
|-----------|-----------------------|
| Lower bound | `n log₂ n - 1.44 n` |
| Merge Sort | `n log₂ n - n + 1` |
| Heap Sort (standard) | `2n log₂ n` |
| Heap Sort (bottom-up) | `n log₂ n + O(n log log n)` |
| Quick Sort | `2n ln n ≈ 1.39 n log₂ n` |
| Tim Sort | adaptive; near-optimal on real data |

Standard Heap Sort is the **worst comparison-counter** among the major `O(n log n)` sorts. Bottom-up brings it in line.

---

## Cache Complexity: Why It's Slow in Practice

### Model: External-Memory / Cache-Oblivious

Define the **cache complexity** as the number of cache-line transfers (block reads from main memory), parametrized by:
- `B` = cache line size (in elements).
- `M` = total cache size.

### Theorem 5 (Heap Sort cache complexity)

Heap Sort on `n` elements performs `Θ((n / B) log₂ n)` cache misses in the worst case (assuming `M ≪ n`).

### Sketch

The build phase touches each level of the heap; for the bottom-most levels (which contain most nodes), each sift-down stays within a single cache line (siblings are adjacent). For the top levels, sift-down crosses many cache lines because children at index `2i + 1` are at memory address `8(2i + 1) = 16i + 8` for 8-byte elements — each level **doubles** the address stride.

A sift-down from the root visits `log₂ n` indices, each in a different cache line (for deep levels). So each of the `n` extractions costs `Θ(log₂ n / 1) = Θ(log₂ n)` misses in the worst case. Total: `Θ(n log₂ n)` cache transfers.

In contrast:

- **Merge Sort** has cache complexity `Θ((n / B) log₂(n / M))` — the `log` factor uses base larger than 2 because each merge pass is sequential. **Provably better than Heap Sort.**
- **Quick Sort** also has `Θ((n / B) log₂(n / M))` — sequential partition.
- **Heap Sort** does NOT achieve this — it has the unfortunate `log₂ n` factor regardless of `M`.

### Implication

For large `n` (greater than `M`, where `M` is L2 / L3 cache size, typically MBs), Heap Sort is **provably slower** than Merge Sort and Quick Sort by a factor of `log₂ n / log₂(n/M)` ≈ `log M`. For `n = 10⁹` and `M = 10⁶` (8 MB L2), this is `30 / 10 = 3×` slower in cache misses, matching empirical results.

### d-ary heap improvements

A `d`-ary heap (children at `di+1, di+2, ..., di+d`) has tree height `log_d n`. For `d = 4`, four siblings fit in one 32-byte block; sift-down does half as many cache misses for the same element count. Empirically, `d = 4` or `d = 8` is the sweet spot.

### Cache-oblivious heaps

Funnel-heaps and B-heaps (Bender et al., 2000) achieve `Θ((1/B) log_{M/B}(n/B))` per operation — cache-optimal — at the cost of significantly more complex code. Used in some research database engines; not widely deployed.

---

## Parallel Heap Sort Is Hard

Unlike Merge Sort (each merge is independent of the others) and Quick Sort (each partition splits the work), Heap Sort has **inherent serialization**.

### Phase 1 (build) — parallelizable

The bottom-up build can be parallelized by processing each level in parallel: all sift-downs at the same level are independent (they touch disjoint subtrees). Level `0` (leaves) is trivially parallel; level `1` has `n/4` independent jobs; ...; the root is sequential.

Total parallel time: `O(log² n)` with `O(n)` work. Each level requires a barrier.

### Phase 2 (extract) — sequential

Each extraction reads and modifies the root. The next extraction depends on the previous one because the root after extraction depends on the heap state. Sequential dependence chain of length `n`. Cannot be parallelized without changing the algorithm.

### Theorem 6 (Heap Sort parallel hardness)

Standard Heap Sort has critical path `Ω(n log n)` (the sequence of `n` extractions, each with `log n` work). Therefore **its work-span ratio is `O(1)`** — no parallelism beyond a single processor.

### Workarounds

- **Sample-based parallel sort** (psort, AlphaSort) uses sampling + bucketing + per-bucket parallel sort. Not Heap Sort, but achieves `O(n)` work / `O(log n)` span.
- **Parallel merge sort** is the standard parallel sort.
- **Pipelined heap sort** processes the next extraction in parallel with the previous sift-down. Constant-factor improvement only (~2×).
- **Multiway merging on parallel heaps** — k threads each maintain a heap of `n/k` elements; merge results. Not exactly Heap Sort, but parallel.

### Implication

If you need parallel sorting, **don't pick Heap Sort**. Pick parallel merge sort, sample sort, or radix sort.

---

## Lower Bound for Comparison Sorting

### Theorem 7 (Comparison-sort lower bound)

Any comparison-based sorting algorithm must perform `Ω(n log n)` comparisons in the worst case.

### Proof (decision tree)

A comparison sort can be modeled as a binary decision tree where each internal node is a comparison and each leaf is a permutation of the input. To distinguish all `n!` permutations, the tree must have at least `n!` leaves. A binary tree with `L` leaves has height at least `⌈log₂ L⌉`. So worst-case height ≥ `⌈log₂(n!)⌉`.

By Stirling, `log₂(n!) ≥ n log₂ n - n log₂ e + O(log n) = Ω(n log n)`. ∎

### Heap Sort matches the bound

By Theorem 4, Heap Sort uses `Θ(n log n)` comparisons in the worst case. So **Heap Sort is asymptotically optimal among comparison sorts**.

The constant factor is suboptimal (`2` vs the lower-bound constant of `1`), but the bottom-up variant achieves the optimal constant.

---

## Heap Sort vs Information-Theoretic Optimum

| Algorithm | Comparisons (n large) | Cache misses (n large) | Space | Stable | Optimal? |
|-----------|-----------------------|------------------------|-------|--------|----------|
| Lower bound | `n log₂ n - 1.44 n` | `(n/B) log_{M/B}(n/B)` | `n + O(1)` | depends | — |
| **Heap Sort (standard)** | `2 n log₂ n` ❌ | `(n/B) log₂ n` ❌ | `O(1)` ✅ | ❌ | comparison count: NO; cache: NO |
| Heap Sort (bottom-up) | `n log₂ n + O(n log log n)` ✅ | `(n/B) log₂ n` ❌ | `O(1)` ✅ | ❌ | comparison: ~OPTIMAL; cache: NO |
| Merge Sort | `n log₂ n - n` ✅ | `(n/B) log₂(n/M)` ✅ | `O(n)` ❌ | ✅ | comparison: OPT; cache: OPT; space: NO |
| Tim Sort | adaptive (≤ Merge) ✅ | `(n/B) log₂(n/M)` ✅ | `O(n)` ❌ | ✅ | best in practice |
| In-place Merge Sort | `O(n log n)` ✅ but huge constant | `O(n log n / B)` ⚠️ | `O(1)` ✅ | ✅ | OPT but slow constant |

Heap Sort is the **only** mainstream sort with `O(1)` space AND `O(n log n)` worst case AND simple code. That's its niche.

If you relax stability, you have Heap Sort.
If you relax space (allow `O(n)`), Merge Sort wins on every other axis.
If you relax worst-case (allow `O(n²)`), Quick Sort wins on every other axis.

---

## Summary

- The **max-heap property** can be precisely formalized as `A[parent(i)] ≥ A[i]` for all `i > 0`; the **complete tree shape** is implicit in the array layout.
- `siftDown` correctness follows by induction on the loop iterations; it preserves the heap property of unaffected subtrees and restores it for the path it walks.
- **Heap Sort correctness** follows by maintaining the loop invariant that `A[0..end]` is a heap and `A[end+1..n-1]` is the sorted suffix with all values ≥ everything in the heap.
- **Build-heap is `Θ(n)`** by the geometric series `Σ h / 2^h = 2`. The naive `O(n log n)` upper bound is not tight.
- **Standard Heap Sort uses `~2n log₂ n` comparisons**; bottom-up sift-down halves this to `~n log₂ n`, matching the lower bound's constant.
- **Cache complexity is `Θ((n/B) log n)`** — strictly worse than Merge Sort and Quick Sort by a factor of `log M`. This is why Heap Sort is slower in wall-clock time despite the same Big-O.
- **Parallel Heap Sort is essentially impossible** beyond constant speedup because the extraction phase is sequential. Use Merge Sort or sample sort for parallel.
- **Heap Sort matches the comparison-sort lower bound `Ω(n log n)`** asymptotically and (with bottom-up) constant-optimally.
- Heap Sort's niche: **`O(1)` space + `O(n log n)` worst case** with simple code. No other algorithm offers all three.

> **Next:** read `interview.md` for graded questions.
