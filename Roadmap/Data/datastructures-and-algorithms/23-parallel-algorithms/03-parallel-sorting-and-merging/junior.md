# Parallel Sorting and Merging — Junior Level

> **Audience:** You know the work–span model — work `T₁` (total operations), span `T∞` (longest dependency chain), parallelism `= work/span` — and you've seen scan turn a "looks sequential" problem into a `Θ(log n)`-span one. You also know serial merge sort (`Θ(n log n)`). Now the question is: how do we sort `n` things *fast in span* using many processors at once?
> **Read time:** ~45 minutes. **Focus:** "Serial sorting is `Θ(n log n)`. How do I get the *span* down to something like `log² n` — and where is the sneaky sequential bottleneck hiding inside a sort?"

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [The Goal: Sort in Small Span, Not Just Small Work](#the-goal-sort-in-small-span-not-just-small-work)
5. [Parallel Merge Sort: Sort Both Halves at Once](#parallel-merge-sort-sort-both-halves-at-once)
6. [The Sneaky Bottleneck: Merging Is the Hard Part](#the-sneaky-bottleneck-merging-is-the-hard-part)
7. [Parallel Merge by Rank: Each Element Finds Its Own Slot](#parallel-merge-by-rank-each-element-finds-its-own-slot)
8. [Walking Parallel Merge on Two Small Arrays](#walking-parallel-merge-on-two-small-arrays)
9. [Counting the Cost of Parallel Merge Sort](#counting-the-cost-of-parallel-merge-sort)
10. [Bitonic Sort: A Sorting Network That Ignores the Data](#bitonic-sort-a-sorting-network-that-ignores-the-data)
11. [Sample Sort: The One People Actually Use](#sample-sort-the-one-people-actually-use)
12. [The Costs Side by Side](#the-costs-side-by-side)
13. [Code: Parallel Merge by Rank](#code-parallel-merge-by-rank)
14. [Code: Parallel Merge Sort](#code-parallel-merge-sort)
15. [Code: Sample-Sort Bucketing](#code-sample-sort-bucketing)
16. [Common Misconceptions](#common-misconceptions)
17. [Common Mistakes](#common-mistakes)
18. [Cheat Sheet](#cheat-sheet)
19. [Summary](#summary)
20. [Further Reading](#further-reading)

---

## Introduction

You already know how to sort. The [serial sorting algorithms](../../07-sorting-algorithms/) — merge sort, quicksort, heapsort — all land at `Θ(n log n)` comparisons, and that's provably the best a comparison sort can do on *one* processor. But "best on one processor" is a statement about **work**, and the whole lesson of this section is that work is only half the story. On a machine with thousands of cores, the number you care about is **span**: the longest chain of operations that *must* happen in order, the floor that no amount of hardware can break through. Serial merge sort has span `Θ(n log n)` — it's a single thread grinding through every comparison one after another. The question of parallel sorting is: **can we sort `n` elements with a span far shorter than `n log n`, so all those processors actually have something to do?**

The answer is a resounding yes, and it's beautiful. The headline result is that you can sort with span `Θ(log² n)` — for a million elements, `log² n ≈ 400`, versus a serial span of `20,000,000`. That's a span roughly **fifty thousand times shorter**. The same `n log n`-ish work, but rearranged into a shape so flat that an army of processors can attack it. This file is about *how* that rearrangement works, and it turns out to hinge on one surprising sub-problem.

Here's the surprise. Parallel **merge sort** seems easy to parallelize: to sort an array, split it in half, sort the two halves — *and the two halves are completely independent, so sort them at the same time* — then merge the two sorted halves back together. The recursion forms a tree of depth `log n`, and at each level the independent subproblems run in parallel. So far so good. But then you hit the **merge** step, and merging two sorted arrays *looks* utterly sequential: the classic two-pointer merge walks both arrays from the front, and each output element seems to depend on the comparison before it — a dependency chain of length `n`. If merge is sequential, the whole sort is sequential, and we've gained nothing. The sneaky bottleneck of parallel sorting lives inside the merge.

The escape is a genuinely clever trick — **parallel merge by rank** — and it's the centerpiece of this file. Instead of walking the arrays, ask a different question for *each element independently*: "where does this element *land* in the merged output?" That landing spot — its **rank** — is just "how many elements come before it," which you can compute with a **binary search** into the other array. Every element computes its own rank simultaneously, with no element waiting on another. Merge, the thing that looked hopelessly serial, becomes `Θ(log n)` span. This is the same flavor of magic you saw with scan: a problem that *seems* to demand left-to-right processing is actually a bunch of independent "where do I go?" lookups in disguise.

We'll build the whole picture from the ground up. We'll watch parallel merge sort's "sort both halves at once" tree; work parallel-merge-by-rank on two tiny arrays by hand so the binary-search-for-your-rank trick clicks; meet **bitonic sort**, a fixed pattern of compare-and-swap operations that sorts *any* input the same way every time (so it maps perfectly onto GPUs and hardware); and see **sample sort**, the bucket-everything-then-sort-each-bucket approach that real multicore and distributed sorts are actually built on. Along the way we'll keep both numbers — work and span — in view, because the entire art is keeping the span small (`log² n`) while not blowing up the work. By the end, "sort in parallel" will be a concrete set of techniques, not a hand-wave.

---

## Prerequisites

- **Required:** The **work–span model** — work `T₁` (total operations = time on one processor), span `T∞` (longest dependency chain = time on infinitely many processors), and **parallelism `= T₁/T∞`**. It's all set up in [Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md), and we use it on every algorithm here.
- **Required:** **Serial merge sort** — split in half, sort each half, merge. And the **two-pointer merge** of two sorted arrays. We parallelize exactly this. See [Merge Sort](../../07-sorting-algorithms/02-merge-sort/junior.md).
- **Required:** **Binary search** — finding where a value fits in a *sorted* array in `Θ(log n)` steps. The parallel merge is built entirely out of binary searches. See [Binary Search](../../05-searching-algorithms/01-binary-search/junior.md) if it's rusty.
- **Required:** That a comparison sort needs `Θ(n log n)` comparisons (the lower bound) — so when we talk about "extra work," you know what baseline we're measuring against.
- **Helpful:** **Parallel scan** from [the previous topic](../02-parallel-prefix-sum-scan/junior.md) — sample sort uses a scan to compute bucket offsets, and the "looks sequential but isn't" mindset transfers directly.
- **Helpful:** A vague picture of "running many threads/goroutines at once." We describe algorithms abstractly and analyze their DAGs, so no real threading is needed to follow along.

No specific hardware, no calculus. Every cost is counted by hand.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Parallel merge sort** | Merge sort where the two recursive sorts run *in parallel* and the merge step is itself parallelized. Work `Θ(n log n)`, span `Θ(log² n)`. |
| **Merge** | Combining two *already-sorted* arrays into one sorted array. The classic version is the two-pointer sequential merge. |
| **Parallel merge by rank** | A merge where each element independently computes its output index (rank) via binary search, then writes there. Span `Θ(log n)`, work `Θ(n)`. |
| **Rank of an element** | Its index in the final merged output = (count of elements before it in its *own* array) + (count of elements smaller than it in the *other* array). |
| **Sorting network** | A fixed sequence of compare-and-swap operations that sorts *any* input. The comparisons don't depend on the data. |
| **Compare-and-swap (CAS here)** | "Look at positions `i` and `j`; if out of order, swap them." The single building block of a sorting network. (Not the atomic CPU instruction of the same name.) |
| **Oblivious algorithm** | One whose operations are fixed in advance, independent of the input values. Sorting networks are oblivious. |
| **Bitonic sort** | A classic sorting network. Depth (span) `Θ(log² n)`, work `Θ(n log² n)`. Maps perfectly to GPUs/SIMD because it's oblivious. |
| **Bitonic sequence** | A sequence that goes up then down (or down then up) — e.g. `1 4 7 6 3 2`. Bitonic sort builds and merges these. |
| **Sample sort** | Pick `k−1` *splitter* values; bucket every element between two splitters (parallel); sort each bucket. The practical multicore/distributed sort. |
| **Splitter** | A chosen value that marks a bucket boundary. Splitters partition the key range into `k` buckets. |
| **Bucket** | The group of elements that fall between two consecutive splitters. Buckets are sorted independently, in parallel. |
| **Work / Span** | (From [topic 01](../01-models-pram-work-span/junior.md).) Work `T₁` = total operations; span `T∞` = longest dependency chain; parallelism `= T₁/T∞`. |

---

## The Goal: Sort in Small Span, Not Just Small Work

Let's be crisp about what we're chasing, because it's easy to think "sorting is already `Θ(n log n)`, isn't that fast enough?" — and miss the point entirely.

When you sort with the serial merge sort you already know, here's its cost in the two-number model:

```
SERIAL MERGE SORT
  Work  T₁ = Θ(n log n)     ← the comparisons; provably optimal for a comparison sort
  Span  T∞ = Θ(n log n)     ← ALSO n log n, because one thread does them all in order
  Parallelism = T₁/T∞ = Θ(1)   ← NONE. A thousand cores can't help.
```

The work is great — you can't beat `n log n` comparisons. But the **span equals the work**, because a single thread executes every comparison one after the other. Parallelism `= work/span = 1`. On a 64-core machine, serial merge sort uses *one* core; the other 63 sit idle. That's the problem we're solving.

Our target is to keep the work close to `Θ(n log n)` (we don't want to do *wildly* more total comparisons) while collapsing the **span** down to something tiny — ideally **polylogarithmic**, like `Θ(log² n)`. Why does that matter so much? Plug in real numbers:

```
For n = 1,000,000:
  serial span      = n log n  ≈ 1,000,000 × 20  =  20,000,000
  parallel span    = log² n   ≈ 20 × 20         =         400

  The span shrinks by a factor of ~50,000.
```

Recall the Brent bound from [topic 01](../01-models-pram-work-span/junior.md): with `P` processors, time `T_P ≈ T₁/P + T∞`. As long as your span `T∞` is small, you get near-linear speedup right up until `P` reaches the parallelism `T₁/T∞`. A serial sort has parallelism `1` — buying processors is pointless. A parallel sort with span `log² n` has parallelism `T₁/T∞ = (n log n)/(log² n) = n/log n` — for a million elements that's about `50,000`. **You could keep fifty thousand processors busy sorting a million numbers.** That is the difference between a sort that scales and one that doesn't.

> **The whole goal in one line:** parallel sorting is not about doing *less* work than `n log n` — that's impossible. It's about **rearranging the same work into a shape with tiny span**, so that the parallelism (`work/span`) becomes huge and the processors you own actually get used. Keep span polylogarithmic, keep work near `n log n`, and the speedup follows.

Now: *how* do we reshape sorting into small span? Three ways, in increasing order of "what real systems use": parallel merge sort, bitonic sort, and sample sort. We start with merge sort because it exposes the central trick.

---

## Parallel Merge Sort: Sort Both Halves at Once

Merge sort is the natural first candidate to parallelize, and the reason is structural. Here is the serial algorithm:

```
mergeSort(A):
    if len(A) <= 1: return A
    mid  = len(A) / 2
    L = mergeSort(A[:mid])      ← sort the left half
    R = mergeSort(A[mid:])      ← sort the right half
    return merge(L, R)          ← combine the two sorted halves
```

Stare at the two recursive calls. `mergeSort(A[:mid])` and `mergeSort(A[mid:])` work on **completely separate parts of the array.** The left sort never reads or writes anything the right sort touches. They are *independent* — and independence is exactly what parallelism feeds on. So we don't have to do them one after the other; we can **do them at the same time.** The only thing that has to wait is the `merge`, which needs both halves finished.

```
parallelMergeSort(A):
    if len(A) <= 1: return A
    mid = len(A) / 2
    L = spawn parallelMergeSort(A[:mid])   ┐ these two run
    R =       parallelMergeSort(A[mid:])   ┘ AT THE SAME TIME
    sync                                    ← wait for both to finish
    return parallelMerge(L, R)              ← then merge (this must be parallel too!)
```

What shape does the recursion make? A balanced binary tree of depth `log₂ n`. At the top, one problem of size `n`. Below it, two of size `n/2`, *running in parallel*. Below that, four of size `n/4`, all in parallel. And so on down to `n` leaves of size 1. Picture sorting 8 elements:

```
                         sort [8 elements]
                        /                 \
            sort [4]                          sort [4]        ← these 2 run AT ONCE
           /        \                        /        \
     sort [2]      sort [2]            sort [2]      sort [2]  ← these 4 run AT ONCE
      /   \         /   \               /   \         /   \
   [1]   [1]     [1]   [1]           [1]   [1]     [1]   [1]   ← all 8: nothing to do

  THEN merge back UP the tree, level by level:
     merge pairs of 1s  → four sorted 2s      (4 merges, all at once)
     merge pairs of 2s  → two sorted 4s        (2 merges, all at once)
     merge pair of 4s   → one sorted 8         (1 merge)
```

The tree has `log₂ n` levels. On the way *down*, splitting is trivial (just compute a midpoint). On the way *up*, we merge — and at each level, all the merges of that level are independent of one another, so they happen in parallel. So the span of the whole sort is roughly:

```
span(parallel merge sort) ≈ (number of levels) × (span of one merge)
                          ≈  log n            × (span of merging)
```

This is the crux. If merging two sorted halves can be done in **`Θ(log n)` span**, then the whole sort has span `≈ log n × log n = log² n` — exactly the polylogarithmic target we wanted. But if merging is **`Θ(n)` span** (the obvious two-pointer way), then the top-level merge alone — merging two halves of total size `n` — has span `n`, and the whole thing collapses back to `Θ(n)` span. *Everything hinges on parallelizing the merge.* So let's confront that.

---

## The Sneaky Bottleneck: Merging Is the Hard Part

Merging two sorted arrays feels like the *easy* part of merge sort. Here's the classic two-pointer merge you've written before:

```
merge(L, R):                     # L and R are each already sorted
    out = []
    i = 0; j = 0
    while i < len(L) and j < len(R):
        if L[i] <= R[j]:
            out.append(L[i]); i += 1     ← took from L
        else:
            out.append(R[j]); j += 1     ← took from R
    ...append the leftovers...
    return out
```

It's `Θ(n)` *work* — one comparison per output element, optimal. But look at its **span**. Each iteration of the loop picks the next smallest element, and *which* array it comes from depends on the comparison, and the pointers `i`, `j` carry state from one iteration to the next. Output element 5 can't be decided until output element 4 is placed, which can't be decided until element 3… It's a **dependency chain of length `n`** — the worst possible shape for parallelism, exactly like the left-to-right running sum from the [scan topic](../02-parallel-prefix-sum-scan/junior.md).

```
two-pointer merge DAG — a pure chain:

  out[0] → out[1] → out[2] → out[3] → ... → out[n-1]
           (each output's choice depends on the pointers after the previous)

  Work Θ(n), Span Θ(n), parallelism Θ(1). NO parallelism.
```

So if we drop the ordinary two-pointer merge into our pretty parallel-merge-sort tree, the top merge — combining the two size-`n/2` halves into the final size-`n` array — has span `Θ(n)` all by itself. That one step single-handedly drags the whole sort's span back up to `Θ(n)`, no matter how nicely the recursion parallelized. **The merge is the bottleneck, and the two-pointer merge is sequential to the bone.**

This is the same situation we were in with prefix sum: an operation that *looks* inherently sequential because each step seems to read the previous step's state. And the escape is the same *kind* of insight: the left-to-right walk is just *one way* to compute the merge — and a bad one for parallelism. The merged output is a **fact about the two input arrays**, not something that must be discovered in order. Every output element has a definite final position determined entirely by the inputs. If each element could figure out its own position *independently*, there'd be no chain at all. That's precisely what parallel merge by rank does.

> **The realization to hold onto:** the two-pointer merge *manufactures* a length-`n` dependency chain by threading everything through two shared pointers — but that chain isn't in the problem, it's in the algorithm. Each merged element's final index is fixed by the inputs alone. Compute those indices *independently* and the chain dissolves into `n` parallel lookups. We've seen this movie before with scan; merging is the next act.

---

## Parallel Merge by Rank: Each Element Finds Its Own Slot

Here is the key trick of the whole topic. We're merging two sorted arrays `L` and `R` into one sorted output. Instead of walking them, we ask, **for each element independently**: "In the final merged array, what index do I land at?" That index is called the element's **rank**.

The rank of an element is simply **how many elements come before it** in the merged output. And in a merge, "how many elements come before me" splits into two clean pieces:

```
rank of element x  =  (how many elements are before x in its OWN array)
                   +  (how many elements in the OTHER array are smaller than x)
```

The first piece is *free* — it's just `x`'s index in its own sorted array. The second piece — "how many elements of the other array are smaller than `x`" — is a count in a **sorted** array, which is *exactly* what **binary search** computes in `Θ(log n)` steps! Binary search for `x` in the other array tells you how many entries are less than `x`. Add the two pieces, and you have `x`'s final output index. Then `x` writes itself there.

```
For each element x in L (in parallel):
    own_index   = x's position in L            (free — it's just the index)
    cross_count = binarySearch(R, x)           (how many of R are < x; Θ(log n))
    rank        = own_index + cross_count
    output[rank] = x                           (write yourself to your final slot)

Same for each element of R, swapping L and R.
```

Why is this parallel? Because **every element computes its own rank with no reference to any other element's computation.** Element `L[3]` binary-searches `R` on its own; element `L[7]` does its own binary search; they never talk. There are no shared pointers, no left-to-right walk, no chain. All `n` elements can compute their ranks *simultaneously*, then all write to their slots *simultaneously*. And because every element lands at a *distinct* index (each output position is filled by exactly one element), the writes never collide — no locks needed, just like the scatter step in [stream compaction](../02-parallel-prefix-sum-scan/junior.md).

Now the two numbers:

```
PARALLEL MERGE BY RANK
  Work  T₁ = Θ(n log n)   ← n elements, each does a Θ(log n) binary search
  Span  T∞ = Θ(log n)     ← all binary searches run at once; one search = log n steps
  Parallelism = n         ← every element is independent
```

Span `Θ(log n)`! The chain of length `n` is gone, replaced by `n` independent binary searches that each take `log n` steps. (A small note on work: this simple version does `Θ(n log n)` work because each of the `n` elements does a full binary search. There's a cleverer version — search only a sample of "splitter" elements to carve the merge into independent chunks, then merge the chunks serially — that brings the work back down to `Θ(n)` with the same `Θ(log n)` span. That refinement lives in [the middle file](./middle.md); the simple per-element version is all we need to see *why* merge parallelizes.)

> **The trick in one sentence:** *don't walk the merge — let every element binary-search its own final position.* An element's output index is "how many come before me," which is its index in its own array plus a binary-search count into the other array. All `n` of these are independent, so merge drops from `Θ(n)` span to `Θ(log n)` span. This single idea is what makes parallel merge sort possible.

---

## Walking Parallel Merge on Two Small Arrays

Let's do it by hand, slowly, because the rank arithmetic is the kind of thing that only clicks once you've watched it. We'll merge these two sorted arrays:

```
L = [ 2,  5,  8 ]        (indices 0, 1, 2)
R = [ 1,  3,  6,  9 ]    (indices 0, 1, 2, 3)

The correct merged result (we'll verify against it):
     [ 1,  2,  3,  5,  6,  8,  9 ]
       0   1   2   3   4   5   6     ← output indices
```

Total size is `3 + 4 = 7`, so output indices run `0..6`. Now compute each element's rank independently.

**Elements of `L` (for each, `rank = its index in L  +  how many of R are smaller):**

```
L[0] = 2:
    own index in L         = 0
    elements of R smaller than 2:  R = [1, 3, 6, 9] → only 1 is < 2 → count = 1
    rank = 0 + 1 = 1          → output[1] = 2  ✓

L[1] = 5:
    own index in L         = 1
    elements of R smaller than 5:  1 and 3 are < 5 → count = 2
    rank = 1 + 2 = 3          → output[3] = 5  ✓

L[2] = 8:
    own index in L         = 2
    elements of R smaller than 8:  1, 3, 6 are < 8 → count = 3
    rank = 2 + 3 = 5          → output[5] = 8  ✓
```

**Elements of `R` (for each, `rank = its index in R  +  how many of L are smaller):**

```
R[0] = 1:
    own index in R         = 0
    elements of L smaller than 1:  L = [2, 5, 8] → none < 1 → count = 0
    rank = 0 + 0 = 0          → output[0] = 1  ✓

R[1] = 3:
    own index in R         = 1
    elements of L smaller than 3:  only 2 is < 3 → count = 1
    rank = 1 + 1 = 2          → output[2] = 3  ✓

R[2] = 6:
    own index in R         = 2
    elements of L smaller than 6:  2 and 5 are < 6 → count = 2
    rank = 2 + 2 = 4          → output[4] = 6  ✓

R[3] = 9:
    own index in R         = 3
    elements of L smaller than 9:  2, 5, 8 are < 9 → count = 3
    rank = 3 + 3 = 6          → output[6] = 9  ✓
```

Now drop every element into the index its rank told it:

```
  rank:   0    1    2    3    4    5    6
        [ 1 ][ 2 ][ 3 ][ 5 ][ 6 ][ 8 ][ 9 ]
          R    L    R    L    R    L    R     ← which array each came from

  Compare to the correct merge:  [1, 2, 3, 5, 6, 8, 9]  ✓ identical!
```

Every slot filled exactly once, no collisions, and the result is perfectly sorted — and **we never compared two elements in sequence.** Each of the seven elements found its own home with an independent count (a binary search, in a big array). With enough processors, all seven happen at the same instant: span = "one binary search" = `Θ(log n)`, not `Θ(n)`.

```
  the seven rank-computations are INDEPENDENT — no arrows between them:

   L[0]?   L[1]?   L[2]?   R[0]?   R[1]?   R[2]?   R[3]?
     │       │       │       │       │       │       │     all fire AT ONCE
     ▼       ▼       ▼       ▼       ▼       ▼       ▼
  out[1]  out[3]  out[5]  out[0]  out[2]  out[4]  out[6]
```

One subtlety worth naming: **duplicates and ties.** If `L` and `R` share a value, you must be careful that the two equal elements don't both claim the *same* output slot. The fix is a tie-breaking rule — e.g. "when searching `R` for an element of `L`, count elements `< x`; when searching `L` for an element of `R`, count elements `≤ x`." That asymmetry makes equal elements land in adjacent, distinct slots (and keeps the merge *stable*). We'll bake exactly that rule into the code below.

> **What you just watched:** the merge of two sorted arrays computed with **zero sequential steps** — seven independent "where do I go?" lookups, each a count-by-binary-search, all collision-free because each rank is distinct. That's parallel merge by rank, the engine inside parallel merge sort.

---

## Counting the Cost of Parallel Merge Sort

Now we can assemble the full sort and count it. Parallel merge sort = the recursion tree (sort both halves at once) + parallel-merge-by-rank at every level on the way up.

**Span.** The recursion has `log₂ n` levels. At each level, all the merges are independent and run in parallel, and each merge has span `Θ(log n)` (the binary-search depth). The two halves at each split also run in parallel, so the "sort" part of a level adds nothing beyond recursing one level deeper. So the span accumulates one `Θ(log n)` merge per level, across `log n` levels:

```
span = (number of levels) × (span of one parallel merge)
     =  Θ(log n)          ×  Θ(log n)
     =  Θ(log² n)
```

**Work.** Total work is the sum over all levels. At each level the merges together process all `n` elements, and our simple per-element merge does a `Θ(log n)` binary search per element, so a level costs `Θ(n log n)`... across `log n` levels that would be `Θ(n log² n)`. With the work-efficient merge (the splitter refinement in [middle](./middle.md)), each merge level is `Θ(n)` work, giving `Θ(n log n)` total — matching the serial sort. We'll quote the work-efficient figure as the "real" cost and note the simple version is a `log n` factor heavier:

```
PARALLEL MERGE SORT
  Work  T₁ = Θ(n log n)    (with the work-efficient merge; simple version is Θ(n log² n))
  Span  T∞ = Θ(log² n)     ← the prize: polylogarithmic span
  Parallelism = T₁/T∞ = (n log n)/(log² n) = n/log n   ← huge
```

For `n = 1,000,000`: span ≈ `400`, parallelism ≈ `50,000`. The same `n log n` work as serial merge sort, but with a span so flat that fifty thousand processors stay busy. That is the entire payoff of the parallel-merge-by-rank trick — it's the difference between span `log² n` and span `n`.

```
                       Work          Span          Parallelism
  serial merge sort    Θ(n log n)    Θ(n log n)    Θ(1)        ← no parallelism
  parallel merge sort  Θ(n log n)    Θ(log² n)     Θ(n/log n)  ← massively parallel

  Same work. The ONLY change is span: n log n  →  log² n.
```

It's the exact same lesson as summing `n` numbers from [topic 01](../01-models-pram-work-span/junior.md): keep the work the same, but reshape the computation so the span collapses from linear-ish to polylogarithmic. Lowering span is how you create parallelism.

---

## Bitonic Sort: A Sorting Network That Ignores the Data

Parallel merge sort is great, but it has a property that hardware designers dislike: its behavior *depends on the data*. Which element binary-searches where, which branch a comparison takes — it all varies with the input. GPUs and SIMD units love the *opposite*: a fixed, predictable pattern of operations that's the same on every run, so thousands of lanes can march in perfect lockstep. That's what a **sorting network** gives you, and **bitonic sort** is the classic one.

A **sorting network** is a fixed sequence of **compare-and-swap** operations. A compare-and-swap on positions `(i, j)` means: "look at `A[i]` and `A[j]`; if they're out of order, swap them." That's the *only* operation. Crucially, **which positions get compared is decided in advance** — it does *not* depend on the values in the array. The network does the *exact same comparisons* whether the input is sorted, reversed, or random. An algorithm like that is called **oblivious**: it's blind to the data. Here's a tiny network that sorts 4 elements (read left to right; each `─┃─` is a compare-and-swap between two wires):

```
  wires (one per array slot), data flows left → right:

  a ─┃───────┃──────
     ┃       ┃         each ┃ connects two wires: compare them,
  b ─┃──┃────┃──┃───       put the smaller on top, larger on bottom
        ┃       ┃
  c ─┃──┃────┃──┃───
     ┃       ┃
  d ─┃───────┃──────

  After all the compare-swaps, the four wires hold a, b, c, d in sorted order —
  for ANY starting values. The pattern of ┃'s never changes.
```

Because the comparison pattern is fixed, **all the compare-swaps in one vertical column are independent** — they touch disjoint pairs of wires — so they all happen *at the same time*. The "depth" of the network (the number of columns) is therefore its **span**, and the total number of compare-swaps is its **work**.

Bitonic sort builds these networks around the idea of a **bitonic sequence** — a sequence that rises then falls (like `1 4 7 6 3 2`) or falls then rises. The clever fact is that a bitonic sequence can be sorted by a regular, recursive pattern of compare-and-swaps. Bitonic sort first arranges the data into a bitonic sequence, then repeatedly applies "bitonic merges" to sort it. You don't need the full recursion to grasp the headline:

```
BITONIC SORT
  Depth (span) = Θ(log² n)    ← about (log n)²/2 columns of compare-swaps
  Work         = Θ(n log² n)  ← each column has n/2 compare-swaps × log²n columns
  Oblivious    = YES           ← same comparisons regardless of the data
```

Note the trade-off versus parallel merge sort: bitonic does the *same* `Θ(log² n)` span, but **more work** — `Θ(n log² n)` instead of `Θ(n log n)`, a `log n` factor heavier. So why would anyone use it? **Because it's oblivious.** That extra work buys you a fixed, branch-free, data-independent pattern that maps *perfectly* onto GPUs, SIMD lanes, and hardware sorting circuits — no divergent branches, no data-dependent memory access, every lane doing the identical compare-swap in lockstep. On a GPU, a "slightly more work but perfectly regular" algorithm often *beats* a "less work but irregular" one, because the regular one keeps all the lanes saturated. Bitonic sort is the workhorse of GPU sorting for exactly this reason.

> **Why bitonic sort exists:** it trades a `log n` factor of *extra work* for being **oblivious** — the same compare-and-swaps every time, independent of the data. That regularity is gold on GPUs and in hardware, where thousands of lanes must do the identical thing in lockstep and data-dependent branches kill performance. "More work, but perfectly parallel and predictable" is sometimes the winning trade — and it's the opposite of the trade parallel merge sort makes.

---

## Sample Sort: The One People Actually Use

Parallel merge sort and bitonic sort are the textbook span-optimal sorts. But if you crack open a real high-performance multicore or distributed sorting library, what you'll usually find is **sample sort** — because it's the one that maps cleanly onto "a modest number of beefy processors each with their own memory," which is what real machines are. It's essentially a parallel, multi-way quicksort. Here's the whole idea in four steps:

```
SAMPLE SORT
  1. SPLITTERS: pick k-1 "splitter" values that roughly divide the key range
                into k equal-sized buckets.  (e.g. for k=4 buckets, pick 3 splitters)
  2. BUCKET:    send every element into the bucket it belongs to (between two
                splitters). Each element decides independently → PARALLEL.
  3. SORT:      sort each bucket independently (the buckets don't interact) → PARALLEL.
  4. CONCAT:    concatenate the sorted buckets. Bucket 0 < bucket 1 < ... so the
                concatenation is already globally sorted.
```

Picture sorting `[5, 2, 8, 1, 9, 3, 7, 4, 6]` with 3 buckets, using splitters `4` and `7` (so bucket 0 = "≤ 4", bucket 1 = "5..7", bucket 2 = "≥ 8"):

```
  input:    [ 5, 2, 8, 1, 9, 3, 7, 4, 6 ]
  splitters:        4         7              (two splitters → three buckets)

  STEP 2 — bucket each element (every element checks the splitters, independently):
    bucket 0 (≤ 4):   [ 2, 1, 3, 4 ]
    bucket 1 (5..7):  [ 5, 7, 6 ]
    bucket 2 (≥ 8):   [ 8, 9 ]

  STEP 3 — sort each bucket (in parallel — buckets don't talk to each other):
    bucket 0:  [ 1, 2, 3, 4 ]
    bucket 1:  [ 5, 6, 7 ]
    bucket 2:  [ 8, 9 ]

  STEP 4 — concatenate, in bucket order:
    [ 1, 2, 3, 4 ] ++ [ 5, 6, 7 ] ++ [ 8, 9 ]  =  [ 1, 2, 3, 4, 5, 6, 7, 8, 9 ]  ✓
```

The beauty: once you've bucketed, every bucket is a totally **independent sorting problem**, so you hand each bucket to a different processor and they sort simultaneously with zero coordination. And because the splitters guarantee *everything in bucket 0 < everything in bucket 1 < …*, you never have to merge — just glue the sorted buckets end to end. There's a real connection to [scan](../02-parallel-prefix-sum-scan/junior.md) hiding here: to know *where* in the output array each bucket starts, you take the bucket sizes and run a scan over them, giving each bucket its starting offset so all elements can be placed in parallel without a shared counter — the same flags→scan→scatter pattern from compaction.

```
  bucket sizes:    [ 4, 3, 2 ]
  scan (offsets):  [ 0, 4, 7 ]    ← bucket 0 starts at index 0, bucket 1 at 4, bucket 2 at 7
                                    so every bucket knows exactly where to write, in parallel
```

The one wrinkle is **picking good splitters**. If your splitters are bad, the buckets come out lopsided — one giant bucket and several empty ones — and the giant bucket becomes a serial bottleneck (one processor does almost all the work). Good sample sorts *sample* the data (hence the name): grab a random subset of elements, sort that small sample, and pick splitters from it, so the buckets come out roughly balanced. That's the practical heart of the algorithm, and the details (oversampling, load balancing, distributed variants) are the subject of the higher tiers.

> **Why sample sort wins in practice:** it matches real hardware. A handful of powerful cores (or machines), each with its own memory, each sorting a whole bucket independently with a fast *serial* sort, no fine-grained synchronization. Bucket-then-sort-each-bucket is "embarrassingly parallel" once the splitters are chosen. It's the foundation of essentially every real parallel/distributed sort — and the only hard part is choosing splitters that keep the buckets balanced.

---

## The Costs Side by Side

Let's lay the three sorts (plus the serial baseline) next to each other so the trade-offs are vivid:

```
                       Work          Span         Oblivious?   Used for
  serial merge sort    Θ(n log n)    Θ(n log n)   —            one core; the baseline
  parallel merge sort  Θ(n log n)    Θ(log² n)    no           theory; shared-memory tasks
  bitonic sort         Θ(n log² n)   Θ(log² n)    YES          GPUs, SIMD, hardware circuits
  sample sort          Θ(n log n)*   (small)**    no           real multicore & distributed

  *  sample sort's work is the bucketing (Θ(n)) plus sorting each bucket
     (Σ bucket-sizes × log = Θ(n log n) total). 
  ** its span depends on the biggest bucket; with balanced splitters, small.
```

The story each row tells:

- **Serial merge sort** — optimal work, but span = work, so zero parallelism. The thing to beat.
- **Parallel merge sort** — *same* work as serial, but span crushed to `log² n`. The cleanest demonstration that "reshape for small span" works. Its only soft spot is the data-dependent merge (irregular, harder on GPUs).
- **Bitonic sort** — a `log n` factor *more* work, but **oblivious** — fixed comparisons that map perfectly to lockstep hardware. The right choice when regularity matters more than minimal work (GPUs).
- **Sample sort** — near-optimal work and "embarrassingly parallel" once splitters are chosen, matching real machines with a few cores and separate memories. The practical winner, at the cost of needing good splitters to stay balanced.

There's no single "best" — the right sort depends on your hardware. **Lots of tiny lockstep lanes (GPU)?** Bitonic's obliviousness wins. **A few big cores with shared memory?** Parallel merge sort or sample sort. **A cluster of machines, each with its own memory?** Sample sort, almost always. What they *share* is the lesson of this whole section: each one keeps the **work** near `Θ(n log n)` while reshaping the computation so the **span** is far below the serial `n log n`. That reshaping is the entire game.

> **The unifying idea:** all three parallel sorts do roughly the same total comparisons as serial sorting — you can't beat `n log n` work. What they do is **rearrange those comparisons into a shape with tiny span** (`log² n` or a small max-bucket), so the parallelism `= work/span` is enormous and real processors stay busy. Span, not work, is what separates a sort that scales from one that doesn't.

---

## Code: Parallel Merge by Rank

Let's make the central trick runnable. The heart is `parallelMerge`: each element computes its own output index (rank) via binary search, then writes there. We simulate the "all at once" with a loop — but every iteration is *independent*, so on real hardware they'd all fire simultaneously. The tie-breaking rule (`< ` when searching the right array for a left element, `≤` the other way) keeps equal elements in distinct, adjacent slots and makes the merge stable.

### Python: parallel merge by rank

```python
import bisect

def parallel_merge(L, R):
    """
    Merge two sorted lists by having each element compute its own output index
    (its rank) via binary search, then write itself there.
    Every rank computation is INDEPENDENT → span Θ(log n), work Θ(n log n).
    The loops below merely SIMULATE the simultaneous, collision-free writes.
    """
    n = len(L) + len(R)
    out = [None] * n

    # Each element of L finds its slot, independently.
    for i, x in enumerate(L):
        # rank = (#elements before x in L)  +  (#elements of R strictly smaller than x)
        # bisect_left(R, x) = how many entries of R are < x  (tie-break: L wins ties)
        cross = bisect.bisect_left(R, x)
        out[i + cross] = x          # write to my OWN distinct slot — no collision

    # Each element of R finds its slot, independently.
    for j, y in enumerate(R):
        # bisect_right(L, y) = how many entries of L are <= y  (the matching tie-break)
        cross = bisect.bisect_right(L, y)
        out[j + cross] = y

    return out


if __name__ == "__main__":
    L = [2, 5, 8]
    R = [1, 3, 6, 9]
    print("L =", L)
    print("R =", R)
    print("merged:", parallel_merge(L, R))   # [1, 2, 3, 5, 6, 8, 9]

    # ties: 5 appears in both — they must land in distinct slots
    A = [1, 4, 5, 9]
    B = [2, 5, 6]
    print("with ties:", parallel_merge(A, B))  # [1, 2, 4, 5, 5, 6, 9]
```

### Go: parallel merge by rank

```go
package main

import (
	"fmt"
	"sort"
)

// parallelMerge merges two sorted slices by computing each element's rank
// (final output index) via binary search, then placing it there.
// Every rank computation is independent → span Θ(log n), work Θ(n log n).
func parallelMerge(L, R []int) []int {
	out := make([]int, len(L)+len(R))

	// Each element of L: rank = its index in L + (#elements of R strictly < x).
	// sort.SearchInts(R, x) returns the count of entries < x (left tie-break).
	for i, x := range L {
		cross := sort.SearchInts(R, x)
		out[i+cross] = x // distinct slot per element — writes never collide
	}

	// Each element of R: rank = its index in R + (#elements of L <= y).
	// Use the first index where L[k] > y, i.e. count of entries <= y.
	for j, y := range R {
		cross := sort.Search(len(L), func(k int) bool { return L[k] > y })
		out[j+cross] = y
	}

	return out
}

func main() {
	L := []int{2, 5, 8}
	R := []int{1, 3, 6, 9}
	fmt.Println("L =", L)
	fmt.Println("R =", R)
	fmt.Println("merged:", parallelMerge(L, R)) // [1 2 3 5 6 8 9]
}
```

> **The crucial detail — distinct slots, no locks.** Because each element's rank is computed from the inputs alone, and every output index is claimed by exactly one element, the writes are *collision-free*. On real hardware, all `n` of these binary-search-and-write operations fire simultaneously with no synchronization — that's the `Θ(log n)` span. The sequential `for` loops here are *simulation only*; judge the cost by the DAG (independent searches), not by the loop. The tie-break asymmetry (`<` for L's elements, `≤` for R's) is what stops two equal values from racing for the same slot.

---

## Code: Parallel Merge Sort

Now wrap the parallel merge in the recursion. The two recursive sorts are independent — in Go we spawn one as a goroutine and run the other on the current one, then a `WaitGroup` syncs before merging. In Python (where the GIL limits true CPU parallelism) we show the clean recursive *structure*; the point is the shape of the DAG, not raw speed.

### Go: parallel merge sort with goroutines

```go
package main

import (
	"fmt"
	"sort"
	"sync"
)

func parallelMerge(L, R []int) []int {
	out := make([]int, len(L)+len(R))
	for i, x := range L {
		out[i+sort.SearchInts(R, x)] = x
	}
	for j, y := range R {
		out[j+sort.Search(len(L), func(k int) bool { return L[k] > y })] = y
	}
	return out
}

// parallelMergeSort sorts A by sorting the two halves IN PARALLEL, then
// merging them with the parallel (rank-based) merge.
// Work Θ(n log n)-ish, span Θ(log² n) with a work-efficient merge.
func parallelMergeSort(A []int) []int {
	if len(A) <= 1 {
		return A
	}
	// Below a threshold, a plain serial sort is faster (avoids goroutine overhead).
	if len(A) <= 2048 {
		B := append([]int(nil), A...)
		sort.Ints(B)
		return B
	}

	mid := len(A) / 2
	var left, right []int
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { // sort the left half in parallel...
		defer wg.Done()
		left = parallelMergeSort(A[:mid])
	}()
	right = parallelMergeSort(A[mid:]) // ...while we sort the right half here
	wg.Wait()                          // barrier: both halves must be done

	return parallelMerge(left, right) // then merge (itself parallel)
}

func main() {
	A := []int{5, 2, 8, 1, 9, 3, 7, 4, 6, 0}
	fmt.Println("input: ", A)
	fmt.Println("sorted:", parallelMergeSort(A)) // [0 1 2 3 4 5 6 7 8 9]
}
```

### Python: parallel merge sort (structure)

```python
import bisect

def parallel_merge(L, R):
    out = [None] * (len(L) + len(R))
    for i, x in enumerate(L):
        out[i + bisect.bisect_left(R, x)] = x
    for j, y in enumerate(R):
        out[j + bisect.bisect_right(L, y)] = y
    return out

def parallel_merge_sort(A):
    """
    Recursion tree of depth log n; the two recursive sorts are INDEPENDENT
    (they touch disjoint halves) so on real hardware they run at the same time.
    Merge with the rank-based parallel merge. Span Θ(log² n).
    """
    if len(A) <= 1:
        return A
    mid = len(A) // 2
    left  = parallel_merge_sort(A[:mid])   # ┐ independent — could run in parallel
    right = parallel_merge_sort(A[mid:])   # ┘ (no shared state between the halves)
    return parallel_merge(left, right)

if __name__ == "__main__":
    A = [5, 2, 8, 1, 9, 3, 7, 4, 6, 0]
    print("input: ", A)
    print("sorted:", parallel_merge_sort(A))   # [0,1,2,3,4,5,6,7,8,9]
```

> **Reading the parallelism off the code.** The two recursive calls touch *disjoint halves* of the array, so they share no state and are independent — that's why they can run at once (the Go version actually spawns a goroutine for the left half). The `WaitGroup`/`sync` is the **barrier**: the merge can't start until both halves are sorted, exactly the dependency that gives the span its `log n` *levels*, each contributing a `log n` merge → `log² n` total. The serial-sort threshold (`len(A) <= 2048`) is a real-world detail: spawning a goroutine to sort three elements costs more than just sorting them, so below a cutoff we stop parallelizing — a standard "coarsen the base case" optimization.

---

## Code: Sample-Sort Bucketing

Finally, sample sort's core move: bucket every element between splitters, then sort each bucket independently. The bucketing is the parallel part (each element finds its bucket on its own); sorting the buckets is embarrassingly parallel (no bucket touches another). We use a scan over bucket sizes to compute where each bucket's output begins.

### Python: sample-sort bucketing

```python
import bisect

def sample_sort(A, splitters):
    """
    Sort A using given sorted `splitters` (the k-1 bucket boundaries → k buckets).
      1. BUCKET: each element finds its bucket via binary search on splitters (parallel).
      2. SORT:   sort each bucket independently (parallel — buckets don't interact).
      3. SCAN:   offsets = exclusive scan of bucket sizes → where each bucket starts.
      4. PLACE:  concatenate sorted buckets in order → globally sorted.
    """
    k = len(splitters) + 1
    buckets = [[] for _ in range(k)]

    # STEP 1 — bucket each element (independent per element → parallel).
    for x in A:
        b = bisect.bisect_right(splitters, x)  # which bucket does x fall into?
        buckets[b].append(x)

    # STEP 2 — sort each bucket (independent per bucket → parallel).
    for b in range(k):
        buckets[b].sort()

    # STEP 3 — exclusive scan of bucket sizes gives each bucket's start offset.
    offsets, running = [], 0
    for b in range(k):
        offsets.append(running)
        running += len(buckets[b])

    # STEP 4 — place each sorted bucket at its offset (parallel: distinct ranges).
    out = [None] * len(A)
    for b in range(k):
        for i, x in enumerate(buckets[b]):
            out[offsets[b] + i] = x
    return out, [len(b) for b in buckets]


if __name__ == "__main__":
    A = [5, 2, 8, 1, 9, 3, 7, 4, 6]
    splitters = [4, 7]            # → 3 buckets: (≤4), (5..7), (≥8)
    result, sizes = sample_sort(A, splitters)
    print("input:        ", A)
    print("bucket sizes: ", sizes)     # [4, 3, 2]
    print("sorted:       ", result)    # [1, 2, 3, 4, 5, 6, 7, 8, 9]
```

### Go: sample-sort bucketing

```go
package main

import (
	"fmt"
	"sort"
)

// sampleSort sorts A using the given sorted splitters (k-1 boundaries → k buckets).
// Bucketing and per-bucket sorting are both parallel; a scan of bucket sizes
// gives each bucket its output offset so placement is collision-free.
func sampleSort(A []int, splitters []int) []int {
	k := len(splitters) + 1
	buckets := make([][]int, k)

	// STEP 1 — bucket each element (independent per element → parallel).
	for _, x := range A {
		b := sort.SearchInts(splitters, x+1) // first splitter > x → x's bucket index
		buckets[b] = append(buckets[b], x)
	}

	// STEP 2 — sort each bucket (independent → parallel).
	for b := range buckets {
		sort.Ints(buckets[b])
	}

	// STEP 3 — exclusive scan of bucket sizes → start offset of each bucket.
	offsets := make([]int, k)
	running := 0
	for b := 0; b < k; b++ {
		offsets[b] = running
		running += len(buckets[b])
	}

	// STEP 4 — place each sorted bucket at its offset (distinct ranges → parallel).
	out := make([]int, len(A))
	for b := 0; b < k; b++ {
		for i, x := range buckets[b] {
			out[offsets[b]+i] = x
		}
	}
	return out
}

func main() {
	A := []int{5, 2, 8, 1, 9, 3, 7, 4, 6}
	splitters := []int{4, 7} // 3 buckets: (<=4), (5..7), (>=8)
	fmt.Println("input: ", A)
	fmt.Println("sorted:", sampleSort(A, splitters)) // [1 2 3 4 5 6 7 8 9]
}
```

> **Where the parallelism lives.** Step 1 (bucketing) is parallel — each element independently binary-searches the *tiny* splitter array to find its bucket. Step 2 (sorting each bucket) is *embarrassingly* parallel — buckets share nothing, so `k` processors sort `k` buckets at once. Step 3 is the [scan](../02-parallel-prefix-sum-scan/junior.md): an exclusive scan of the bucket sizes hands each bucket a distinct output range, so step 4's placement never collides — no shared write counter. The whole sort's span is dominated by the *largest* bucket's serial sort, which is why **balanced splitters matter so much**: one giant bucket means one processor doing nearly all the work, and your parallelism evaporates. Real sample sorts *sample* the input to choose balanced splitters — the next tier's main subject.

---

## Common Misconceptions

- **"Parallel sorting beats the `n log n` work bound."** No. The `Θ(n log n)` comparison lower bound is about *work*, and it still holds — every parallel sort here does `Θ(n log n)` work (or more, for bitonic). What parallel sorting changes is the **span**, crushing it from `n log n` to `log² n`. You're not doing less work; you're doing the same work in a flatter shape so processors can share it.

- **"Merging two sorted arrays is the easy, already-parallel part."** It's the *sneaky bottleneck*. The classic two-pointer merge is a length-`n` dependency chain — span `Θ(n)`, the worst shape for parallelism. Drop it into parallel merge sort and the whole sort's span collapses back to `Θ(n)`. The merge is precisely the part you have to work to parallelize (via rank/binary-search).

- **"An element's position in the merge depends on the merge happening step by step."** No — each element's final index is a *fact about the inputs*: its own index plus how many of the other array are smaller. That's computable independently with a binary search. The "step by step" is an artifact of the two-pointer algorithm, not the problem.

- **"Bitonic sort is worse than parallel merge sort because it does more work."** It does `Θ(n log² n)` work — a `log n` factor more — but it's **oblivious**: a fixed, branch-free comparison pattern that maps perfectly onto GPUs and SIMD lanes. On that hardware, the regularity is worth more than minimal work, and bitonic often *wins*. "More work but perfectly regular" is a real, often-correct trade.

- **"Sample sort's only job is bucketing."** The make-or-break part is **choosing good splitters**. Bad splitters give lopsided buckets — one huge bucket becomes a serial bottleneck that one processor grinds through while the others idle, killing your speedup. Good sample sorts *sample* the data to pick balanced splitters; that's the real engineering.

- **"More processors always sorts faster."** Only up to the parallelism `T₁/T∞ = n/log n`. Past that, extra processors idle (Brent bound, from [topic 01](../01-models-pram-work-span/junior.md)), and for sample sort an imbalanced biggest bucket caps you regardless. Compute the parallelism to know how many processors are worth using.

---

## Common Mistakes

- **Parallelizing the recursion but leaving a serial merge.** This is *the* classic error. You spawn goroutines for the two halves, feel clever, and call the ordinary two-pointer `merge` — whose `Θ(n)` span at the top level single-handedly drags the whole sort back to `Θ(n)` span. The merge *must* be parallel (rank-based) for the sort to be parallel. Parallelizing only the easy half is parallelizing nothing.

- **Mishandling ties in the rank computation.** If both arrays contain the same value and you use the *same* binary-search rule for both (`<` for both, say), the two equal elements compute the *same* rank and collide on one output slot — corrupting the result. Use the asymmetric tie-break: count `<` when searching one array, `≤` when searching the other. This gives equal elements distinct, adjacent slots (and keeps the merge stable).

- **Forgetting to coarsen the base case.** Recursing all the way down to size-1 subarrays and spawning a thread/goroutine for each is a disaster — the coordination overhead dwarfs the actual sorting of a handful of elements. Below a threshold (e.g. a few thousand), switch to a plain serial sort. Every real parallel sort does this.

- **Choosing unbalanced splitters in sample sort.** Hardcoded or naive splitters produce one giant bucket and several empty ones. The giant bucket is then sorted by a single processor — a serial bottleneck that erases your parallelism. *Sample* the input (sort a random subset, pick splitters from it) to keep buckets roughly equal.

- **Updating shared state inside a parallel level.** A shared output counter, a shared pointer, a shared "next slot" variable — any of these reintroduces a serial dependency and races. The rank-based merge and the scan-based bucket offsets exist precisely to give every element a *precomputed, distinct* destination so no shared counter is needed. Never reintroduce one.

- **Judging cost by the simulation's loops.** The code uses `for` loops to *simulate* the simultaneous, independent operations (rank computations, bucket placements). The real cost is the **span** — the depth of the independent operations' DAG (`log n` for one merge, `log² n` for the sort), not the loop iteration count. Read the cost off the dependency structure, not the `for`.

---

## Cheat Sheet

```
THE GOAL
  Serial sort: work Θ(n log n), SPAN Θ(n log n) → parallelism Θ(1) (no parallelism).
  Parallel sort: keep work ~Θ(n log n), crush SPAN to ~Θ(log² n) → parallelism n/log n.
  You can't beat n log n WORK; you reshape it into small SPAN. Span = what scales.

PARALLEL MERGE SORT
  Sort the two halves IN PARALLEL (they're independent), then MERGE.
  Recursion tree depth log n; merges at each level run in parallel.
  span = (log n levels) × (span of one merge).  Need a PARALLEL merge or it's all wasted.

THE BOTTLENECK: merging two sorted arrays
  two-pointer merge: work Θ(n), SPAN Θ(n) — a length-n chain. Sequential to the bone.

PARALLEL MERGE BY RANK (the key trick)
  Each element finds its OWN output index (rank), independently:
     rank(x) = (x's index in its own array) + (#elements of the OTHER array < x)
             = own_index + binarySearch(other, x)
  All n ranks computed at once → SPAN Θ(log n) (one binary search), work Θ(n log n).
  Distinct ranks → collision-free writes, no locks. Tie-break: < one side, ≤ the other.

PARALLEL MERGE SORT COST
  Work Θ(n log n) (work-efficient merge),  SPAN Θ(log² n),  parallelism n/log n.

BITONIC SORT (a sorting NETWORK)
  Fixed pattern of compare-and-swaps; OBLIVIOUS (same comparisons regardless of data).
  Depth (span) Θ(log² n), work Θ(n log² n) — a log n factor MORE work.
  Worth it because it maps perfectly to GPUs / SIMD / hardware (lockstep, no branches).

SAMPLE SORT (the practical one)
  1. pick k-1 SPLITTERS  2. BUCKET each element between splitters (parallel)
  3. SORT each bucket independently (parallel)  4. CONCAT in bucket order (no merge!)
  Scan of bucket sizes → each bucket's output offset. Needs BALANCED splitters (sample!).
  The basis of real multicore & distributed sorts.

THE TRADE-OFFS
  parallel merge sort  work n log n   span log²n   data-dependent (shared mem)
  bitonic sort         work n log²n   span log²n   OBLIVIOUS (GPUs/hardware)
  sample sort          work ~n log n  small span   needs good splitters (real systems)
```

---

## Summary

Serial comparison sorting is `Θ(n log n)` work — and you can't beat that. But its **span** is also `Θ(n log n)` (one thread, every comparison in order), so its parallelism is `Θ(1)`: a thousand cores can't help. Parallel sorting is the art of keeping the work near `n log n` while **reshaping the computation so the span collapses to something polylogarithmic** like `Θ(log² n)`, making the parallelism `n/log n` enormous so real processors stay busy.

- **Parallel merge sort** parallelizes the obvious way: the two recursive sorts touch disjoint halves, so they're independent and run *at the same time*, forming a recursion tree of depth `log n`. The catch is the **merge**: the classic two-pointer merge is a length-`n` dependency chain (span `Θ(n)`) that, dropped into the tree, drags the whole sort's span back to `Θ(n)`. The merge is the sneaky bottleneck.

- **Parallel merge by rank** breaks that bottleneck. Each element independently computes its **rank** — its final output index — as *(its index in its own array)* + *(how many of the other array are smaller, via a binary search)*. All `n` ranks are computed simultaneously, with no element waiting on another, and each lands at a distinct slot (collision-free, no locks). The chain dissolves into `n` parallel binary searches: span `Θ(log n)`. (A tie-break — `<` on one side, `≤` on the other — keeps equal elements in distinct slots and the merge stable.)

- **The cost of parallel merge sort:** `log n` recursion levels × `Θ(log n)` per merge = **span `Θ(log² n)`**, with **work `Θ(n log n)`** (using a work-efficient merge). Same work as serial; parallelism `n/log n` — for a million elements, ~50,000. Lowering span is how parallelism is created, exactly as with the reduction tree in [topic 01](../01-models-pram-work-span/junior.md).

- **Bitonic sort** is a **sorting network**: a fixed sequence of compare-and-swaps that sorts *any* input, **oblivious** to the data. Depth `Θ(log² n)`, work `Θ(n log² n)` — a `log n` factor *more* work than parallel merge sort. The payoff: a regular, branch-free pattern that maps perfectly onto GPUs, SIMD, and hardware, where lockstep regularity beats minimal work. "More work, perfectly parallel" is sometimes the right trade.

- **Sample sort** is the one real systems use: pick `k−1` **splitters**, **bucket** every element between two splitters (parallel), **sort each bucket** independently (embarrassingly parallel), and **concatenate** — no merge needed, since bucket 0 < bucket 1 < … A [scan](../02-parallel-prefix-sum-scan/junior.md) over bucket sizes gives each bucket its output offset. The make-or-break detail is choosing **balanced splitters** (by sampling the data); a lopsided bucket becomes a serial bottleneck.

The big idea to carry forward: **parallel sorting doesn't reduce the work — it reshapes it into small span.** Whether by binary-searching each element's rank (merge sort), laying down a fixed oblivious network (bitonic), or bucketing into independent sub-sorts (sample sort), every approach keeps the comparisons near `Θ(n log n)` while flattening the span far below the serial `n log n`. Span, not work, is what decides whether a sort scales — and finding the small-span shape is the whole craft.

**Next steps:** [the middle-level treatment](./middle.md) builds the *work-efficient* parallel merge (splitter-based, `Θ(n)` work / `Θ(log n)` span), develops the full bitonic-merge recursion, and digs into sample sort's splitter-selection and load-balancing. The whole framework rests on the [work–span model](../01-models-pram-work-span/junior.md); [parallel prefix sum / scan](../02-parallel-prefix-sum-scan/junior.md) is the primitive behind sample sort's bucket offsets; and the [serial sorting algorithms](../../07-sorting-algorithms/) are the baseline every parallel sort is measured against.

---

## Further Reading

- **Cormen, Leiserson, Rivest & Stein, *Introduction to Algorithms* (CLRS), "Multithreaded Algorithms"** — the parallel merge-by-rank analysis and the work–span treatment of parallel merge sort, in the exact framework used throughout this section. The best next read.
- **Batcher (1968), "Sorting Networks and Their Applications"** — the original paper introducing bitonic sort (and odd-even merge sort), the foundation of oblivious parallel sorting.
- **Blelloch, *Prefix Sums and Their Applications*** — connects scan to sample-sort bucketing and parallel partitioning; great companion to the [scan topic](../02-parallel-prefix-sum-scan/junior.md).
- **Mark Harris et al., GPU Gems / "Designing Efficient Sorting Algorithms for Manycore GPUs"** — why oblivious networks like bitonic sort win on GPUs, with real performance pictures.
- **[Models of Parallel Computation: PRAM and Work–Span](../01-models-pram-work-span/junior.md)** — work, span, parallelism, and the Brent bound this topic relies on.
- **[Parallel Prefix Sum (Scan)](../02-parallel-prefix-sum-scan/junior.md)** — the scan primitive behind sample sort's bucket offsets, and the same "looks sequential but isn't" mindset.
- **[Serial Sorting Algorithms](../../07-sorting-algorithms/)** — merge sort, quicksort, and the `Θ(n log n)` baseline every parallel sort is measured against.
- **[Parallel Sorting and Merging — Middle](./middle.md)** — the work-efficient parallel merge, the full bitonic-merge recursion, and sample-sort splitter selection in depth.
