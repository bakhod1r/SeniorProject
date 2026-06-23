# Parallel Sorting and Merging — Middle Level

## Table of Contents

1. [Introduction](#introduction)
2. [Parallel Merge, Rigorously](#parallel-merge-rigorously)
   - [The Problem and the Sequential Baseline](#the-problem-and-the-sequential-baseline)
   - [Rank-by-Binary-Search: Θ(n log n) Work, Θ(log n) Span](#rank-by-binary-search-θn-log-n-work-θlog-n-span)
   - [Co-Ranking / Merge-Path: Θ(n) Work, Θ(log n) Span](#co-ranking--merge-path-θn-work-θlog-n-span)
   - [Proof That Merge-Path Is Correct](#proof-that-merge-path-is-correct)
3. [Parallel Merge Sort](#parallel-merge-sort)
   - [The Recurrences for Work and Span](#the-recurrences-for-work-and-span)
   - [Why the Merge Decides Everything](#why-the-merge-decides-everything)
4. [Sorting Networks and the 0-1 Principle](#sorting-networks-and-the-0-1-principle)
   - [Comparators and Oblivious Sorting](#comparators-and-oblivious-sorting)
   - [The 0-1 Principle](#the-0-1-principle)
   - [Bitonic Sequences and the Bitonic Merger](#bitonic-sequences-and-the-bitonic-merger)
   - [Bitonic Sort: Θ(log² n) Depth, Θ(n log² n) Work](#bitonic-sort-θlog²-n-depth-θn-log²-n-work)
   - [Batcher's Odd-Even Mergesort](#batchers-odd-even-mergesort)
5. [Sample Sort: The Practical Parallel Sort](#sample-sort-the-practical-parallel-sort)
   - [The Algorithm](#the-algorithm)
   - [The Splitter Step and Oversampling](#the-splitter-step-and-oversampling)
   - [Bucketing via Scan](#bucketing-via-scan)
   - [Load-Balance Analysis](#load-balance-analysis)
6. [Parallel Radix Sort](#parallel-radix-sort)
7. [Code: Parallel Merge, Merge Sort, Bitonic, Sample Sort](#code-parallel-merge-merge-sort-bitonic-sample-sort)
   - [Go](#go)
   - [Python](#python)
8. [Pitfalls](#pitfalls)
9. [Summary](#summary)

---

## Introduction

> Focus: turn the junior facts — parallel merge sort, merge-by-rank, bitonic, the sample-sort idea — into rigorous statements you can *prove*. By the end you can derive co-ranking / merge-path and show it merges in `Θ(n)` work and `Θ(log n)` span, solve the merge-sort recurrences to `Θ(n log n)` work and `Θ(log² n)` span, prove the **0-1 principle** and read off bitonic sort's `Θ(log² n)` depth, and analyze sample sort's load balance under oversampling.

At the [junior level](./junior.md) you met the parallel sorts as pictures: **parallel merge sort** (recurse on halves, then merge in parallel), **merge by rank** (find where each element lands), the **bitonic** sorting network, and the **sample sort** idea (pick splitters, bucket, sort buckets). You also met the [work–span model](../01-models-pram-work-span/middle.md): **work** `T₁` (total operations, = 1-processor time), **span** `T∞` (critical-path length, = ∞-processor time), and **work-efficiency** (`T₁ = Θ(T_seq)`).

This file makes those sorts rigorous:

- **Parallel merge** is the crux. The naive **rank-by-binary-search** merge ranks each element with one binary search — `Θ(n log n)` work, `Θ(log n)` span: short span, but *not* work-efficient. The **co-ranking / merge-path** method splits the merge along a diagonal of the `|A|×|B|` grid, binary-searching the split point — `Θ(n)` work, `Θ(log n)` span. We prove it.
- **Parallel merge sort** layers a parallel merge on the recursion: work `T₁(n) = Θ(n log n)` (matching the sequential sort), and with the log-span merge, span `T∞(n) = T∞(n/2) + Θ(log n) = Θ(log² n)`. We derive both recurrences.
- **Sorting networks**: the **0-1 principle** (a comparator network sorts *all* inputs iff it sorts all 0-1 inputs), **bitonic sequences** and the **bitonic merger**, giving **bitonic sort** at depth `Θ(log² n)` and `Θ(n log² n)` comparators. **Batcher's odd-even mergesort** matches the depth.
- **Sample sort**: pick `p−1` splitters by *oversampling then selecting*, partition `n` elements into `p` buckets using a [scan](../02-parallel-prefix-sum-scan/middle.md), then sort each bucket. Oversampling keeps every bucket near `n/p` with high probability — the standard practical parallel sort.
- **Parallel radix sort**: each digit is a stable split driven by a [scan](../02-parallel-prefix-sum-scan/middle.md) — `Θ(n)` work, `Θ(log n)` span per digit.

A note on vocabulary used throughout:

| Symbol | Meaning |
|--------|---------|
| `n` | number of elements to sort (or `|A| + |B|` for a merge) |
| `p` | number of processors / buckets in sample sort |
| `T₁` | **work** — total operations |
| `T∞` | **span** — critical-path length |
| **depth** | for a sorting network, the number of parallel comparator stages |
| **comparators** | for a sorting network, the total compare-exchange count (= work) |

Throughout we analyze in the [work–span model](../01-models-pram-work-span/middle.md). All logarithms are base 2; where convenient we take `n` to be a power of two — the bounds are unchanged for general `n` (pad to the next power of two, at most doubling the size). Sorting networks *require* the padding; we return to it in the [pitfalls](#pitfalls).

---

## Parallel Merge, Rigorously

### The Problem and the Sequential Baseline

**Merge.** Given two sorted arrays `A[0..m−1]` and `B[0..n−1]`, produce one sorted array `C[0..m+n−1]` containing all `m + n` elements. The sequential merge is the textbook two-finger scan: `Θ(m + n)` work, but its span is *also* `Θ(m + n)` — it is a single dependency chain, each output depending on the previous finger positions. To merge in parallel we must break that chain.

The whole game is: **let each output position discover where it comes from, independently of every other position.** If position `k` of `C` can compute its source `A[i]` or `B[j]` without waiting for position `k−1`, then all `m + n` outputs are independent and the span collapses to whatever the per-position computation costs. Two methods do this; they differ in work.

### Rank-by-Binary-Search: Θ(n log n) Work, Θ(log n) Span

The first idea is direct. In the merged output, element `A[i]` lands at index

```text
  rank(A[i]) = i + (number of B-elements that come before A[i])
             = i + (count of B[j] < A[i])         // ties broken toward A for stability
```

Because `B` is sorted, "count of `B[j] < A[i]`" is a single **binary search** of `A[i]` into `B`. So:

```text
  for all i in parallel:   C[ i + lowerBound(B, A[i]) ] = A[i]
  for all j in parallel:   C[ j + upperBound(A, B[j]) ] = B[j]
```

Each element does one binary search of cost `Θ(log n)`, and all elements are independent.

> **Claim.** Rank-by-binary-search merges `A`, `B` in **work `T₁ = Θ((m+n) log n)`** and **span `T∞ = Θ(log n)`**.

**Span.** Every output is computed by one independent binary search of depth `Θ(log n)`; nothing waits on anything else. `T∞ = Θ(log n)`.

**Work.** There are `m + n` elements, each paying `Θ(log n)` for its binary search: `T₁ = Θ((m + n) log n)`.

This is correct and has optimal span, but it is **not work-efficient**: sequential merge is `Θ(m + n)`, so we are a factor of `log n` over. The redundancy is obvious — adjacent elements `A[i]` and `A[i+1]` binary-search into nearly the same place, re-deriving almost the same `B`-position from scratch. Merge-path fixes exactly this.

### Co-Ranking / Merge-Path: Θ(n) Work, Θ(log n) Span

Picture the merge as a monotone path on an `(m+1) × (n+1)` grid. The cell `(i, j)` means "we have consumed `A[0..i−1]` and `B[0..j−1]`," i.e. we have produced `i + j` outputs. The merge starts at `(0,0)` and ends at `(m, n)`; each output step moves **right** (take a `B`-element, `j++`) or **down** (take an `A`-element, `i++`). The path is the merge.

The key observation: the cells with `i + j = k` form an **anti-diagonal**, and the merge path crosses each anti-diagonal in *exactly one* cell `(i, j)` — that cell is the **co-rank** of output index `k`. Find `(i, j)` with `i + j = k`, and you know that the first `k` outputs are exactly `A[0..i−1]` merged with `B[0..j−1]`.

```text
        B0  B1  B2  B3  B4
      ┌───┬───┬───┬───┬───┐
   A0 │   │   │ ● │   │   │   the merge path (●) is monotone:
      ├───┼───┼───┼───┼───┤   right = take B, down = take A.
   A1 │   │   │   │ ● │   │   diagonal i+j=k crosses it once →
      ├───┼───┼───┼───┼───┤   that crossing is the co-rank (i,j).
   A2 │   │   │   │   │ ● │
      └───┴───┴───┴───┴───┘
```

To merge in parallel, **chop the output into `P` contiguous segments** at the diagonals `k = 0, t, 2t, …` (with `t = (m+n)/P`). For each diagonal `k`, find the co-rank `(i, j)` with `i + j = k`. Then segment `s` of the output is the sequential merge of `A[i_s .. i_{s+1}−1]` with `B[j_s .. j_{s+1}−1]` — independent of every other segment.

How do we find the co-rank `(i, j)` on diagonal `k`? Since `i + j = k`, we only need `i` (then `j = k − i`). The valid `i` lies in `[max(0, k−n), min(k, m)]`, and the path crosses the diagonal where `A` and `B` "balance":

```text
  (i, j) is the co-rank iff   A[i−1] ≤ B[j]   AND   B[j−1] < A[i]      (j = k − i)
  (with the boundary conventions A[−1] = B[−1] = −∞, A[m] = B[n] = +∞)
```

This condition is **monotone in `i`** — increasing `i` strengthens the first inequality and weakens the second — so we **binary-search `i`** over its `O(min(k, m, n))`-wide range. One binary search per diagonal, `Θ(log n)` each.

> **Claim.** Merge-path merges `A`, `B` in **work `T₁ = Θ(m + n)`** and **span `T∞ = Θ(log n)`**, and it is **work-efficient**.

**Span.** Two phases. (1) Co-rank the `P` diagonals — `P` independent binary searches, `Θ(log n)` each, all parallel → `Θ(log n)`. (2) Merge the `P` segments — each is a *sequential* two-finger merge of `Θ((m+n)/P)` elements. With `P = (m+n)/log n` we make every segment `Θ(log n)` long, so each segment merge costs `Θ(log n)`, and they are all parallel. Total span `T∞ = Θ(log n)`.

**Work.** Co-ranking does `P · Θ(log n)` work; with `P = (m+n)/log n` that is `Θ(m + n)`. The segment merges together touch each element once: `Θ(m + n)`. Total `T₁ = Θ(m + n)` — matching sequential merge, **work-efficient**. (Even at the extreme `P = m + n`, one binary search per output, the work is `Θ((m+n) log n)` — that is rank-by-binary-search again. The *point* of merge-path is to co-rank only `O((m+n)/log n)` diagonals and merge the gaps sequentially, recovering linear work.)

```text
  rank-by-binary-search:  T₁ = Θ((m+n) log n)   T∞ = Θ(log n)   work-efficient? NO
  merge-path / co-rank:   T₁ = Θ(m+n)           T∞ = Θ(log n)   work-efficient? YES
```

### Proof That Merge-Path Is Correct

> **Lemma (the co-rank is unique and correct).** For each `k ∈ [0, m+n]` there is exactly one pair `(i, j)` with `i + j = k`, `0 ≤ i ≤ m`, `0 ≤ j ≤ n`, satisfying
> ```text
>   A[i−1] ≤ B[j]   and   B[j−1] < A[i]      (boundary ±∞ as above).
> ```
> For this `(i, j)`, the smallest `k` outputs of the merge are exactly the multiset `A[0..i−1] ∪ B[0..j−1]`.

**Proof.** Fix `k` and let `j = k − i`, so the only free variable is `i ∈ [max(0,k−n), min(k,m)]`. Define
```text
  f(i) = 1  if A[i−1] ≤ B[k−i],   else 0.
```
As `i` increases by 1, `A[i−1]` does not decrease (A sorted) and `B[k−i]` does not increase (B sorted, index drops), so once `f` becomes `0` it stays `0`: `f` is **monotone non-increasing** in `i`. Likewise the second predicate `g(i) = [B[k−i−1] < A[i]]` is monotone *non-decreasing*. At the low end of the range `g` holds and `f` may fail; at the high end `f` holds and `g` may fail. The two monotone step functions cross at exactly one `i` where **both** hold — that is the unique co-rank. (Binary search finds it: test `A[mid−1] ≤ B[k−mid]`; if it holds, move right, else move left.)

*Why those outputs.* The condition `A[i−1] ≤ B[j]` says every one of `A[0..i−1]` is ≤ everything in `B[j..n−1]`, and `B[j−1] < A[i]` says every one of `B[0..j−1]` is < everything in `A[i..m−1]`. Hence the `i + j = k` elements `A[0..i−1] ∪ B[0..j−1]` are all ≤ the remaining `A[i..] ∪ B[j..]`. Being the `k` smallest, in sorted order they are precisely the first `k` outputs of the merge. ∎

The lemma is what makes the parallel merge *embarrassingly* parallel after co-ranking: each segment knows its exact input ranges and merges them with no cross-talk.

---

## Parallel Merge Sort

Parallel merge sort is the familiar recursion with a **parallel merge** at every combine step, and the two halves sorted **in parallel**:

```text
  pMergeSort(X):
      if |X| ≤ 1: return X
      in parallel:                       // fork the two recursive sorts
          L ← pMergeSort(left half)
          R ← pMergeSort(right half)
      return parallelMerge(L, R)         // merge-path: Θ(n) work, Θ(log n) span
```

### The Recurrences for Work and Span

**Work.** Work ignores parallelism — it is the total operation count, identical to the sequential algorithm's:
```text
  T₁(n) = 2·T₁(n/2) + W_merge(n),     W_merge(n) = Θ(n)   (merge-path)
        = 2·T₁(n/2) + Θ(n).
```
By the master theorem (`a = 2`, `b = 2`, `f(n) = Θ(n)`, the balanced case), `T₁(n) = Θ(n log n)`. This matches the sequential `Θ(n log n)` merge sort — parallel merge sort is **work-efficient**. (Had we used the rank-by-binary-search merge with `W_merge = Θ(n log n)`, the work recurrence would solve to `Θ(n log² n)` — work-*inefficient*, the first reason to prefer merge-path.)

**Span.** Span follows the critical path. The two recursive sorts run **in parallel**, so we pay for *one* of them (a `T∞(n/2)`), then the merge's span `Θ(log n)` in series after the join:
```text
  T∞(n) = T∞(n/2) + S_merge(n),     S_merge(n) = Θ(log n)   (merge-path)
        = T∞(n/2) + Θ(log n).
```
Unrolling the recurrence over its `log n` levels of recursion, level `ℓ` (problem size `n/2^ℓ`) contributes `Θ(log(n/2^ℓ)) = Θ(log n − ℓ)` to the span:
```text
  T∞(n) = Σ_{ℓ=0}^{log n − 1} Θ(log n − ℓ)
        = Θ( log n + (log n − 1) + … + 1 )
        = Θ( (log n)(log n + 1) / 2 )
        = Θ(log² n).
```
So **parallel merge sort with merge-path has work `Θ(n log n)` and span `Θ(log² n)`**, giving parallelism `T₁/T∞ = Θ(n log n / log² n) = Θ(n / log n)`.

```text
  parallel merge sort:  T₁ = Θ(n log n)   T∞ = Θ(log² n)   parallelism = Θ(n / log n)
```

### Why the Merge Decides Everything

The recursion itself contributes only a `Θ(log n)` chain of forks/joins — *trivially* parallel. The span is dominated entirely by the merges stacked along the critical path: `log n` levels, each a `Θ(log n)`-span merge, multiplying to `Θ(log² n)`. The lesson, restated as a slogan:

> **In parallel merge sort, the merge is the hard part, not the recursion.** Replace the merge and the whole bound moves: a sequential merge (`Θ(n)` span) gives `T∞ = Θ(n)` — barely parallel; the log-span merge-path gives `Θ(log² n)`; and a more elaborate `Θ(log log n)`-span pipelined merge (Cole's merge sort, [senior](./senior.md)) gives `Θ(log n)` span — span-optimal. Everything hinges on how fast you can merge.

A summary table for the merge sort, by which merge you bolt on:

| Merge used | `W_merge` | `S_merge` | Sort work `T₁` | Sort span `T∞` |
|------------|-----------|-----------|----------------|----------------|
| sequential two-finger | `Θ(n)` | `Θ(n)` | `Θ(n log n)` | `Θ(n)` |
| rank-by-binary-search | `Θ(n log n)` | `Θ(log n)` | `Θ(n log² n)` | `Θ(log² n)` |
| **merge-path / co-rank** | `Θ(n)` | `Θ(log n)` | `Θ(n log n)` | `Θ(log² n)` |
| Cole's pipelined merge | `Θ(n)` | `Θ(log log n)` | `Θ(n log n)` | `Θ(log n)` |

The merge-path row is the sweet spot for this level: work-efficient *and* polylog span, with a merge you can actually write.

---

## Sorting Networks and the 0-1 Principle

A different family ignores recursion entirely. A **sorting network** is a fixed sequence of **compare-exchange** operations on fixed wire positions — *oblivious*: the comparisons it performs do not depend on the data, only on the positions. Obliviousness is exactly what makes networks ideal for SIMD/GPU hardware (no data-dependent branching) and for the parallel models.

### Comparators and Oblivious Sorting

A **comparator** `[i, j]` on two wires reads `a[i], a[j]` and writes them back **sorted**: `a[i] ← min`, `a[j] ← max`. A **network** is a list of comparators; its **depth** is the number of parallel stages (comparators on disjoint wires run in one stage), and its **size** is the total comparator count. For the [work–span model](../01-models-pram-work-span/middle.md), **depth = span** and **size = work**.

```text
  one compare-exchange  [i,j]:   if a[i] > a[j] then swap(a[i], a[j])    // ⇒ a[i] ≤ a[j]
```

The hard part of designing a network is *proving it sorts every input*. There are `n!` permutations to check — but the **0-1 principle** reduces that to `2ⁿ`, and in practice to a single structural argument.

### The 0-1 Principle

> **The 0-1 Principle.** A comparator network sorts *every* input sequence (over any ordered domain) **if and only if** it sorts every **0-1** input sequence.

**Proof.** ($\Rightarrow$) Trivial: 0-1 sequences are a special case of all inputs.

($\Leftarrow$) Suppose the network sorts all 0-1 inputs but **fails** on some arbitrary input `x`, producing an output `y` that is not sorted — so `y[a] > y[b]` for some `a < b`. The crux is a lemma about monotone functions:

> **Lemma.** For any monotone non-decreasing `f` (`u ≤ v ⇒ f(u) ≤ f(v)`), if a network maps input `x` to output `y`, then it maps input `f(x)` (apply `f` element-wise) to output `f(y)`.

*Proof of lemma.* A single comparator computes `min` and `max`, and any monotone `f` **commutes** with both: `f(min(u,v)) = min(f(u), f(v))` and `f(max(u,v)) = max(f(u), f(v))`. So applying `f` to the inputs of any comparator applies `f` to its outputs. By induction over the comparators in network order, `f` applied to the whole input yields `f` applied to the whole output. ∎ (lemma)

Now pick the **threshold** monotone function
```text
  f(t) = 0  if t < y[a],   else 1.
```
Apply the lemma: the network maps `f(x)` (a **0-1** sequence) to `f(y)`. But `y[a] > y[b]` means `f(y[a]) = 1` and `f(y[b]) = 0`, with `a < b` — so `f(y)` has a `1` *before* a `0`, i.e. `f(y)` is **not sorted**. Thus the network fails on the 0-1 input `f(x)`, contradicting the assumption that it sorts all 0-1 inputs. Therefore no such `x` exists: the network sorts every input. ∎

This is the workhorse of network design: to verify *any* network, you only argue about zeros and ones flowing through it. We use it immediately for bitonic sort.

### Bitonic Sequences and the Bitonic Merger

> **Definition (bitonic).** A sequence is **bitonic** if it first non-decreases then non-increases (`↑↓`), or is a cyclic rotation of such a sequence. Equivalently, it has at most one "local maximum" going around. (Examples: `1 3 5 4 2`, `4 2 1 3 5`, any sorted or reverse-sorted sequence.)

The engine is the **bitonic merger**, which turns a bitonic sequence into a sorted one. For a bitonic sequence of length `n` (a power of two), one **half-cleaner** stage compares each `a[i]` with `a[i + n/2]`:

```text
  half-cleaner(a, n):
      for i in 0 .. n/2 − 1 in parallel:
          compare-exchange [i, i + n/2]      // a[i] ← min, a[i+n/2] ← max
```

> **Bitonic-split property.** After one half-cleaner on a bitonic sequence of length `n`: (i) every element of the **first** half is ≤ every element of the **second** half, and (ii) **each half is itself bitonic**.

**Proof (via the 0-1 principle).** It suffices to check 0-1 inputs. A bitonic 0-1 sequence is one of the forms `0…01…10…0` or `1…10…01…1` (a block of one symbol bracketed by the other). Comparing `a[i]` with `a[i+n/2]` and writing min to the low half, max to the high half: a short case analysis on where the `0`-block and `1`-block fall (relative to `n/2`) shows the low half ends up all-`0` then maybe a bitonic remainder, the high half all-`1` similarly, every low ≤ every high, and both halves bitonic. Since it holds for all 0-1 inputs, by the [0-1 principle](#the-0-1-principle) it holds for all inputs. ∎

Recursing the half-cleaner on each (now bitonic, and order-separated) half fully sorts the sequence:

```text
  bitonicMerge(a, n):                       // a is bitonic; sorts it
      if n == 1: return
      half-cleaner(a, n)                     // one parallel stage, n/2 comparators
      bitonicMerge(a[0   .. n/2−1], n/2)     // both recurse in parallel
      bitonicMerge(a[n/2 .. n−1],   n/2)
```

The merger has **depth `log n`** (one half-cleaner per recursion level, the two recursions parallel) and **`(n/2)·log n` comparators**.

### Bitonic Sort: Θ(log² n) Depth, Θ(n log² n) Work

Bitonic *sort* builds a bitonic sequence and then merges it, bottom-up. Merge adjacent pairs into sorted runs of 2 (one up, one down → bitonic of length 4), merge those into sorted runs of 4, and so on — at each level building length-`2^k` bitonic sequences and merging them:

```text
  bitonicSort(a, n):                         // n a power of two
      for k = 2, 4, 8, …, n:                  // build & merge bitonic runs of size k
          for each block of size k in parallel:
              bitonicMerge(block, k)          // alternate ↑ / ↓ direction per block
```

> **Claim.** Bitonic sort has **depth `Θ(log² n)`** and **`Θ(n log² n)` comparators (work)**.

**Depth.** There are `log n` outer stages (`k = 2, 4, …, n`); stage `k` runs `bitonicMerge` of depth `log k`. Summing depths:
```text
  depth = Σ_{s=1}^{log n} s  =  (log n)(log n + 1)/2  =  Θ(log² n).
```
**Work.** Stage `k` has `bitonicMerge`s totaling `(n/2)·log k` comparators (each merger does `(size/2)·log(size)`, and the blocks partition all `n` wires). Summing:
```text
  comparators = Σ_{s=1}^{log n} (n/2)·s  =  (n/2)·Θ(log² n)  =  Θ(n log² n).
```

```text
  bitonic sort:  depth (span) = Θ(log² n)   comparators (work) = Θ(n log² n)
```

Bitonic sort is **not work-efficient** (`Θ(n log² n)` vs the sequential `Θ(n log n)` — a `log n` factor), but it is *oblivious* and has small, regular constants — it is the standard choice on **GPUs** and in hardware, where the data-independent structure is worth the extra work.

### Batcher's Odd-Even Mergesort

Batcher's other network, **odd-even mergesort**, also achieves **depth `Θ(log² n)`** and `Θ(n log² n)` comparators, by an oblivious merge of two sorted halves: recursively merge the **even-indexed** subsequences and the **odd-indexed** subsequences, then a single parallel stage of compare-exchanges `[2i, 2i+1]` cleans up the interleaving. Its merge has depth `Θ(log n)`, so the full sort is `Θ(log² n)` deep by the same telescoping sum as bitonic. Both are corollaries of the [0-1 principle](#the-0-1-principle): you prove the odd-even merge correct by checking it on 0-1 inputs. The two networks are interchangeable at this level; bitonic is more commonly implemented because its index pattern is a clean power-of-two stride.

---

## Sample Sort: The Practical Parallel Sort

The networks are elegant but work-inefficient, and merge sort's recursion has limited parallelism per level. **Sample sort** is the algorithm real parallel libraries use: a single round of *partitioning* into `p` buckets, then independent local sorts. It is essentially a parallel `p`-way quicksort with carefully chosen pivots.

### The Algorithm

```text
  sampleSort(X, p):                          // sort n elements with p processors
      1. SAMPLE & SELECT: choose p−1 splitters  s_1 < s_2 < … < s_{p−1}
      2. BUCKET: assign each x to bucket b where s_{b−1} ≤ x < s_b
                 (compute per-bucket offsets via a SCAN, then scatter)
      3. SORT: sort each of the p buckets independently (sequential or recursive)
      4. CONCATENATE: bucket 0, then 1, …, then p−1   (already globally sorted)
```

Because every element of bucket `b` is `< ` every element of bucket `b+1` (by the splitters), concatenating the sorted buckets gives a globally sorted array — no merge step at all. That is the appeal: replace `log n` levels of merging with **one** partition pass.

### The Splitter Step and Oversampling

The quality of the sort is the quality of the splitters: ideally each bucket gets exactly `n/p` elements. Picking `p−1` splitters at random risks badly skewed buckets (a heavy bucket dominates the runtime — the load-balance bottleneck). The fix is **oversampling**:

```text
  splitter selection (oversampling factor k, a "sample" of size k·p):
      1. draw a random sample S of  k·p  elements from X
      2. sort S
      3. take splitters at evenly spaced ranks:
           s_t = S[ t·k − 1 ]   for t = 1 .. p−1      // every k-th sample element
```

Sampling `k·p` elements and keeping every `k`-th as a splitter makes the splitters *representative* of the global distribution. Larger `k` → tighter buckets but a more expensive sample sort; in practice `k = Θ(log n)` (or a small constant times it) balances the two. The sample of size `kp ≪ n` is cheap to sort.

### Bucketing via Scan

Once splitters are fixed, bucketing is a **counting-scan-scatter**, exactly the pattern from [parallel prefix sum / scan](../02-parallel-prefix-sum-scan/middle.md):

```text
  1. CLASSIFY: for each x, find its bucket index b(x) by binary-searching the
               p−1 splitters                              — Θ(n log p) work, Θ(log p) span
  2. COUNT:    histogram count[b] = #{ x : b(x) = b }     — Θ(n) work
  3. SCAN:     exclusive scan of count[] → offset[b]
               = starting index of bucket b in the output  — Θ(p) work, Θ(log p) span
  4. SCATTER:  place each x at offset[b(x)] + (its rank within bucket b(x))
                                                            — Θ(n) work, Θ(1) span
```

Step 3 is the load-bearing scan: the exclusive prefix-sum of bucket counts gives each bucket's starting offset in the output array, so the scatter writes every element to a collision-free slot — the *same* enumerate→scan→scatter idiom that drives [stream compaction and the radix split](../02-parallel-prefix-sum-scan/middle.md). The classify/count/scan/scatter pass is **`Θ(n log p)` work, `Θ(log p)` span**; then sorting the `p` buckets adds the local-sort cost.

### Load-Balance Analysis

The performance question is: how big can the largest bucket get? If buckets were exactly `n/p`, sorting them in parallel would be perfectly balanced. Oversampling controls the deviation.

> **Claim (informal).** With oversampling factor `k = Θ(log n)`, every bucket has size `O(n/p)` **with high probability** — no bucket exceeds, say, `2·n/p` except with probability polynomially small in `n`.

**Why.** A bucket `b` is "too big" only if more than `2n/p` elements fall between consecutive chosen splitters `s_{b−1}` and `s_b`. Those splitters were the `(t·k−1)`-th order statistics of a size-`kp` random sample. By a Chernoff bound, the empirical rank of an element in a random sample of size `kp` concentrates around its true rank with deviation `O(√(kp))` relative to `kp`; choosing `k = Θ(log n)` shrinks the relative deviation enough that the gap between adjacent splitters contains `Θ(n/p)` true elements w.h.p. Intuitively: a bigger sample estimates the quantiles more accurately, so the splitters land closer to the ideal `n/p`-quantiles, so the buckets are closer to equal. The full Chernoff argument is in [senior](./senior.md).

**Cost (with balanced buckets).** Classify/count/scan/scatter is `Θ(n log p)` work, `Θ(log p)` span. Sorting `p` buckets of size `Θ(n/p)` each, in parallel, with a sequential `Θ(m log m)` sort, is span `Θ((n/p) log(n/p))` and work `Θ(n log(n/p)) = Θ(n log n)` (for `p ≤ n^{1−ε}`). So sample sort is **work-efficient `Θ(n log n)`**, with span dominated by the local sort `Θ((n/p) log(n/p))` plus the `Θ(log p)` partition. Its great practical virtue: **one** communication/partition round, then embarrassingly parallel local sorts — minimal data movement, exactly what distributed and many-core machines want.

---

## Parallel Radix Sort

Radix sort sidesteps comparisons: it sorts `w`-bit keys by processing digits least-significant first, **stably** partitioning by each digit. Each digit-pass is a [scan](../02-parallel-prefix-sum-scan/middle.md)-driven split — the parallel radix sort is "scan all the way down."

For a 1-bit digit (the **split** primitive), each element's destination is:
```text
  if bit = 0:   (#zeros before it)             = exclusive-scan of (1 − bit)
  if bit = 1:   totalZeros + (#ones before it) = totalZeros + exclusive-scan of bit
```
Compute the exclusive scan of the "is-zero" flags and of the "is-one" flags, offset the ones by the total zero count, then scatter. One bit-pass is **`Θ(n)` work, `Θ(log n)` span** (the scan dominates the span; everything else is element-wise). A `w`-bit key is `w` passes:

```text
  parallel radix sort (1-bit digit):  T₁ = Θ(w·n)   T∞ = Θ(w·log n)
```

For a `d`-bit digit (radix `2^d`), each pass builds a `2^d`-bucket histogram and **scans the histogram** to get bucket offsets (the same count/scan/scatter as [sample sort's bucketing](#bucketing-via-scan)), giving `⌈w/d⌉` passes — fewer, wider passes, the same scan engine. For fixed-width integer keys, parallel radix sort is **work-efficient** (`Θ(wn) = Θ(n)` for constant `w`) and is, in practice, the fastest GPU sort — built entirely on the [parallel scan](../02-parallel-prefix-sum-scan/middle.md).

---

## Code: Parallel Merge, Merge Sort, Bitonic, Sample Sort

The theory predicts measurable facts:

1. Merge-path co-ranks `P` diagonals with `P` binary searches, then merges the gaps sequentially — `Θ(m+n)` work, `Θ(log n)` span. The merged output equals the sequential merge.
2. Parallel merge sort does `Θ(n log n)` work with `Θ(log² n)` span (`log n` levels of `log n`-span merges).
3. Bitonic sort is an *oblivious* network — the same compare-exchanges regardless of data — of depth `Θ(log² n)`.
4. Sample sort partitions into `p` buckets via a scan of bucket counts, then sorts each.

The code implements all four (verified against a sequential sort), counting comparisons or span where instructive.

### Go

```go
package main

import (
	"fmt"
	"sort"
)

// coRank returns (i, j) with i+j = k such that merging A[:i] with B[:j]
// yields the k smallest elements. Binary search on i. Θ(log n).
func coRank(k int, A, B []int) (int, int) {
	lo := max(0, k-len(B))
	hi := min(k, len(A))
	for lo < hi {
		i := (lo + hi) / 2
		j := k - i
		// want: A[i-1] <= B[j]  AND  B[j-1] < A[i]
		if i > 0 && j < len(B) && A[i-1] > B[j] {
			hi = i - 1 // i too big
		} else if j > 0 && i < len(A) && B[j-1] >= A[i] {
			lo = i + 1 // i too small
		} else {
			return i, k - i
		}
	}
	return lo, k - lo
}

// parallelMerge merges sorted A, B by co-ranking P diagonals and merging
// the P segments. (Segments are merged sequentially here; they are independent
// and would run in parallel.) Work Θ(m+n), span Θ(log n) with P = (m+n)/log.
func parallelMerge(A, B []int, P int) []int {
	m, n := len(A), len(B)
	C := make([]int, m+n)
	for s := 0; s < P; s++ {
		kStart := s * (m + n) / P
		kEnd := (s + 1) * (m + n) / P
		iS, jS := coRank(kStart, A, B)
		iE, jE := coRank(kEnd, A, B)
		// sequential two-finger merge of A[iS:iE] with B[jS:jE] into C[kStart:]
		i, j, out := iS, jS, kStart
		for i < iE && j < jE {
			if A[i] <= B[j] {
				C[out] = A[i]
				i++
			} else {
				C[out] = B[j]
				j++
			}
			out++
		}
		for i < iE {
			C[out] = A[i]
			i++
			out++
		}
		for j < jE {
			C[out] = B[j]
			j++
			out++
		}
	}
	return C
}

// parallelMergeSort: recurse on halves (in parallel conceptually), merge-path combine.
func parallelMergeSort(X []int) []int {
	if len(X) <= 1 {
		return X
	}
	mid := len(X) / 2
	L := parallelMergeSort(append([]int(nil), X[:mid]...))
	R := parallelMergeSort(append([]int(nil), X[mid:]...))
	return parallelMerge(L, R, max(1, (len(X))/8)) // a few diagonals for the demo
}

// bitonicSort sorts a (length power-of-two) slice with Batcher's oblivious network.
func bitonicSort(a []int) {
	n := len(a)
	for k := 2; k <= n; k <<= 1 { // build bitonic runs of size k
		for j := k >> 1; j > 0; j >>= 1 { // half-cleaner stages
			for i := 0; i < n; i++ {
				l := i ^ j
				if l > i {
					ascending := (i & k) == 0 // direction alternates per block
					if (ascending && a[i] > a[l]) || (!ascending && a[i] < a[l]) {
						a[i], a[l] = a[l], a[i]
					}
				}
			}
		}
	}
}

// sampleSort: oversample splitters, bucket via histogram+scan, sort buckets.
func sampleSort(X []int, p int) []int {
	n := len(X)
	if n <= p || p < 2 {
		out := append([]int(nil), X...)
		sort.Ints(out)
		return out
	}
	// 1. sample k*p elements (k = oversampling factor), pick p-1 splitters.
	k := 4
	sample := make([]int, 0, k*p)
	for i := 0; i < k*p; i++ {
		sample = append(sample, X[(i*2654435761)%n]) // cheap pseudo-random pick
	}
	sort.Ints(sample)
	splitters := make([]int, p-1)
	for t := 1; t < p; t++ {
		splitters[t-1] = sample[t*k-1]
	}
	// 2. classify each element into a bucket via binary search of splitters.
	bucketOf := func(x int) int { return sort.SearchInts(splitters, x+1) }
	count := make([]int, p)
	for _, x := range X {
		count[bucketOf(x)]++
	}
	// 3. exclusive scan of counts → bucket offsets.
	offset := make([]int, p)
	for b := 1; b < p; b++ {
		offset[b] = offset[b-1] + count[b-1]
	}
	// 4. scatter into buckets, then sort each bucket (independent / parallel).
	out := make([]int, n)
	cur := append([]int(nil), offset...)
	for _, x := range X {
		b := bucketOf(x)
		out[cur[b]] = x
		cur[b]++
	}
	for b := 0; b < p; b++ {
		end := n
		if b+1 < p {
			end = offset[b+1]
		}
		sort.Ints(out[offset[b]:end]) // sort bucket b in place
	}
	return out
}

func main() {
	A := []int{1, 4, 6, 8, 9}
	B := []int{2, 3, 5, 7, 10}
	fmt.Println("parallel merge:   ", parallelMerge(A, B, 3))

	X := []int{9, 3, 7, 1, 8, 2, 6, 4, 5, 0, 11, 10}
	fmt.Println("parallel mergesort:", parallelMergeSort(append([]int(nil), X...)))

	bt := []int{9, 3, 7, 1, 8, 2, 6, 4} // length 8 = power of two
	bitonicSort(bt)
	fmt.Println("bitonic sort:     ", bt)

	fmt.Println("sample sort:      ", sampleSort(append([]int(nil), X...), 4))
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
```

Expected output:

```text
parallel merge:    [1 2 3 4 5 6 7 8 9 10]
parallel mergesort: [0 1 2 3 4 5 6 7 8 9 10 11]
bitonic sort:      [1 2 3 4 6 7 8 9]
sample sort:       [0 1 2 3 4 5 6 7 8 9 10 11]
```

Each routine matches a fully sorted output: the merge-path merger interleaves `A` and `B` correctly by co-ranking; the recursive sort builds on it; the oblivious bitonic network sorts its power-of-two input with data-independent compare-exchanges; and sample sort partitions by oversampled splitters, scans the bucket counts into offsets, scatters, and sorts each bucket — concatenation is already globally sorted.

### Python

```python
import bisect
import random


def co_rank(k, A, B):
    """Return (i, j), i+j=k, so merging A[:i] with B[:j] gives the k smallest. Θ(log n)."""
    lo, hi = max(0, k - len(B)), min(k, len(A))
    while lo < hi:
        i = (lo + hi) // 2
        j = k - i
        if i > 0 and j < len(B) and A[i - 1] > B[j]:
            hi = i - 1                      # i too big
        elif j > 0 and i < len(A) and B[j - 1] >= A[i]:
            lo = i + 1                      # i too small
        else:
            return i, k - i
    return lo, k - lo


def parallel_merge(A, B, P):
    """Merge sorted A, B by co-ranking P diagonals; segments merge independently."""
    m, n = len(A), len(B)
    C = [0] * (m + n)
    for s in range(P):
        k0, k1 = s * (m + n) // P, (s + 1) * (m + n) // P
        i, j = co_rank(k0, A, B)
        iE, jE = co_rank(k1, A, B)
        out = k0
        while i < iE and j < jE:            # sequential merge of the segment
            if A[i] <= B[j]:
                C[out], i = A[i], i + 1
            else:
                C[out], j = B[j], j + 1
            out += 1
        while i < iE:
            C[out], i, out = A[i], i + 1, out + 1
        while j < jE:
            C[out], j, out = B[j], j + 1, out + 1
    return C


def parallel_merge_sort(X):
    if len(X) <= 1:
        return list(X)
    mid = len(X) // 2
    L = parallel_merge_sort(X[:mid])
    R = parallel_merge_sort(X[mid:])
    return parallel_merge(L, R, max(1, len(X) // 8))


def bitonic_sort(a):
    """In-place oblivious Batcher bitonic network; len(a) must be a power of two."""
    n = len(a)
    k = 2
    while k <= n:                           # build bitonic runs of size k
        j = k >> 1
        while j > 0:                        # half-cleaner stages
            for i in range(n):
                l = i ^ j
                if l > i:
                    ascending = (i & k) == 0
                    if (ascending and a[i] > a[l]) or (not ascending and a[i] < a[l]):
                        a[i], a[l] = a[l], a[i]
            j >>= 1
        k <<= 1


def sample_sort(X, p, k=4, seed=1):
    """Oversample p-1 splitters, bucket via histogram + exclusive scan, sort buckets."""
    n = len(X)
    if n <= p or p < 2:
        return sorted(X)
    rng = random.Random(seed)
    sample = sorted(rng.choice(X) for _ in range(k * p))
    splitters = [sample[t * k - 1] for t in range(1, p)]   # every k-th sample element

    bucket_of = lambda x: bisect.bisect_right(splitters, x)
    count = [0] * p
    for x in X:
        count[bucket_of(x)] += 1

    offset = [0] * p                                       # exclusive scan of counts
    for b in range(1, p):
        offset[b] = offset[b - 1] + count[b - 1]

    out = [0] * n                                          # scatter into buckets
    cur = offset[:]
    for x in X:
        b = bucket_of(x)
        out[cur[b]] = x
        cur[b] += 1

    for b in range(p):                                     # sort each bucket
        end = offset[b + 1] if b + 1 < p else n
        out[offset[b]:end] = sorted(out[offset[b]:end])
    return out


def main():
    A, B = [1, 4, 6, 8, 9], [2, 3, 5, 7, 10]
    print("parallel merge:    ", parallel_merge(A, B, 3))

    X = [9, 3, 7, 1, 8, 2, 6, 4, 5, 0, 11, 10]
    print("parallel mergesort:", parallel_merge_sort(X))

    bt = [9, 3, 7, 1, 8, 2, 6, 4]
    bitonic_sort(bt)
    print("bitonic sort:      ", bt)

    print("sample sort:       ", sample_sort(X, 4))


if __name__ == "__main__":
    main()
```

Both programs make the abstractions tangible: `co_rank` is one binary search per diagonal (the linear-work parallel merge engine), `parallel_merge_sort` stacks it for `Θ(n log n)` work / `Θ(log² n)` span, `bitonic_sort` is the *oblivious* `Θ(log² n)`-depth network (same compares for every input), and `sample_sort` shows the partition-once pattern — oversample, histogram, **exclusive-scan the counts into offsets**, scatter, sort buckets — that real parallel sorts use.

---

## Pitfalls

- **Thinking the recursion is the hard part of parallel merge sort.** The fork/join recursion contributes only a `Θ(log n)` chain — it parallelizes trivially. **The merge dominates the span:** a sequential merge gives `T∞ = Θ(n)` (barely parallel), the [merge-path](#co-ranking--merge-path-θn-work-θlog-n-span) merge gives `Θ(log² n)`, and Cole's pipelined merge gives `Θ(log n)`. If your parallel merge sort is slow, profile the *merge*, not the recursion.

- **Using rank-by-binary-search and calling it work-efficient.** Ranking each element with its own binary search is `Θ(n log n)` work for a *merge* (and `Θ(n log² n)` for the whole sort) — a `log n` factor over the linear-work merge. Co-rank only `O(n/log n)` diagonals and merge the gaps sequentially; that is the difference between work-efficient and wasteful. Short span is worthless if you bought it by inflating the work.

- **Off-by-one in the co-rank predicate.** The co-rank `(i, j)` with `i + j = k` is the *unique* point with `A[i−1] ≤ B[j]` **and** `B[j−1] < A[i]` (boundaries `±∞`). Mixing `<` and `≤` (the tie-break that decides stability) or testing the wrong inequality moves the split and corrupts a segment. Use one consistent tie-break for both `A`-into-`B` and `B`-into-`A` ranking, and verify the merged output against a sequential merge.

- **Bitonic / odd-even mergesort needs a power-of-two length.** The networks are defined on `n = 2^k` wires; on other sizes you must **pad** up to the next power of two — with `+∞` sentinels for an ascending sort (so the padding sinks to the top and is discarded), never with arbitrary or zero values. Padding with the wrong sentinel silently injects elements into the sorted order.

- **Bitonic sort is not work-efficient.** It does `Θ(n log² n)` comparators against the sequential `Θ(n log n)` — a `log n` factor of extra work. Choose it for its *obliviousness* (no data-dependent branches → ideal for SIMD/GPU/hardware), not for work-optimality. For work-efficient parallel sorting prefer merge sort or sample sort.

- **Sample sort load imbalance without oversampling.** Picking `p−1` splitters from a tiny or unoversampled sample lets one bucket swell far past `n/p`; the largest bucket's local sort then dominates the wall-clock time, destroying the speedup. **Oversample** (sample `k·p`, keep every `k`-th; `k = Θ(log n)` is a safe default) so every bucket is `Θ(n/p)` with high probability. Skewed or duplicate-heavy inputs especially need the larger sample.

- **Forgetting the scan in the bucketing / radix steps.** Both sample sort's bucketing and radix sort's per-digit split need the **exclusive scan of bucket/flag counts** to turn local membership into a collision-free global offset; without it, two elements race for the same output slot. This is the same enumerate→scan→scatter idiom as [stream compaction](../02-parallel-prefix-sum-scan/middle.md) — get the scan right and the scatter is trivially correct.

---

## Summary

- **Parallel merge is the crux.** **Rank-by-binary-search** ranks each element with one binary search → **work `Θ(n log n)`, span `Θ(log n)`** (short span, *not* work-efficient). **Co-ranking / merge-path** views the merge as a monotone path on the `|A|×|B|` grid; co-rank a diagonal `i + j = k` by binary-searching the unique split with `A[i−1] ≤ B[j]` and `B[j−1] < A[i]`, then merge the `O(n/log n)` gaps sequentially → **work `Θ(n)`, span `Θ(log n)`**, work-efficient. The uniqueness/correctness is a two-monotone-functions argument.

- **Parallel merge sort.** Work `T₁(n) = 2T₁(n/2) + Θ(n) = Θ(n log n)` (work-efficient). Span `T∞(n) = T∞(n/2) + Θ(log n) = Θ(log² n)` with the log-span merge — the recursion is trivial, the stacked merges set the span. Parallelism `Θ(n / log n)`.

- **Sorting networks** are *oblivious* (data-independent compare-exchanges). The **0-1 principle** — a network sorts all inputs iff it sorts all 0-1 inputs — is proved by the monotone-`f` lemma (comparators commute with monotone maps) plus a threshold function; it reduces verification from `n!` to `2ⁿ` and in practice to one structural check. **Bitonic sort** (bitonic split via half-cleaner, recursed) has **depth `Θ(log² n)`, `Θ(n log² n)` comparators**; **Batcher's odd-even mergesort** matches the depth. Both are *not* work-efficient but ideal for GPUs/hardware.

- **Sample sort** is the practical parallel sort: **oversample** `k·p` elements and keep every `k`-th as a splitter, **bucket** the `n` elements via classify→histogram→**exclusive scan of counts→scatter** ([scan](../02-parallel-prefix-sum-scan/middle.md)), then **sort each bucket** and concatenate. Oversampling (`k = Θ(log n)`) keeps every bucket `Θ(n/p)` w.h.p. (Chernoff), giving work-efficient `Θ(n log n)` in **one** partition round — minimal data movement.

- **Parallel radix sort** is scan all the way down: each digit is a stable split whose destinations come from an **exclusive scan** of the flag/histogram counts — **`Θ(n)` work, `Θ(log n)` span per digit**, `⌈w/d⌉` digits. Work-efficient for fixed-width keys; the fastest GPU sort in practice.

Revisit [junior](./junior.md) for the pictures and intuition; advance to [senior](./senior.md) for Cole's `Θ(log n)`-span pipelined merge sort, the AKS `Θ(log n)`-depth sorting network, the full Chernoff load-balance proof for sample sort, and cache/communication-aware parallel sorting. Continue to the [work–span model](../01-models-pram-work-span/middle.md) for the cost framework behind every bound here, and to [parallel prefix sum / scan](../02-parallel-prefix-sum-scan/middle.md) for the scan that powers sample-sort bucketing and radix split.
