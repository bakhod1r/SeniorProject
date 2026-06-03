# Quicksort — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Partition Correctness: Loop Invariants and Proof
3. Three-Way Partition Correctness (Dutch National Flag)
4. The Quicksort Recurrence and Worst-Case Proof
5. Expected-Comparison Analysis of Randomized Quicksort
6. Best Case and the Balanced-Split Recurrence
7. Quickselect: Expected O(n) Proof
8. Median-of-Medians: Worst-Case O(n) Selection
9. Stack-Space and Tail-Recursion Bounds
10. Stability and the Comparison-Sort Lower Bound
11. Concentration: Why Quadratic Is Astronomically Unlikely
12. Solving the Average-Case Recurrence Directly
13. Dual-Pivot Quicksort: Why Two Pivots Help
14. Median-of-Three: How Much Does It Help?
15. Quickselect Variance and the Floyd-Rivest Refinement
16. The Recursion Tree, Visually
17. The Entropy Lower Bound for Sorting with Duplicates
18. Summary

---

## 1. Formal Definitions

Let `A[0..n-1]` be an array of `n` elements drawn from a totally ordered set, compared via a relation `<` satisfying the strict-weak-ordering axioms (irreflexive, asymmetric, transitive, with transitive incomparability).

**Definition 1.1 (Sorted).** `A` is *sorted* (ascending) iff `A[i] ≤ A[i+1]` for all `0 ≤ i < n-1`. A sorting algorithm outputs a permutation of the input multiset that is sorted.

**Definition 1.2 (Partition).** Given a subarray `A[lo..hi]` and a pivot value `v`, a *partition* rearranges the subarray and returns an index `p` (Lomuto) or split point (Hoare) such that all elements left of the boundary are `≤ v` and all right are `≥ v`. In Lomuto, `A[p] = v` and `p` is the pivot's final sorted position.

**Definition 1.3 (Rank / order statistic).** The *rank* of an element is its 0-indexed position in sorted order. The *k-th order statistic* is the element of rank `k`; the median is the order statistic of rank `⌊(n-1)/2⌋`.

**Definition 1.4 (Comparison model).** A *comparison sort* accesses elements only through pairwise comparisons. Running time is measured as the number of comparisons (and swaps), each `O(1)`. All lower bounds in Section 10 are in this model.

**Definition 1.5 (Indicator random variable).** For event `E`, `X_E = 1` if `E` occurs, else `0`. Then `E[X_E] = Pr[E]`. This is the workhorse of the average-case analysis (Section 5).

**Remark.** The central object is the partition: every quicksort property — correctness, the `O(n log n)` average, the `O(n²)` worst case, in-place operation, instability — is a consequence of how partition behaves and how the pivot is chosen.

---

## 2. Partition Correctness: Loop Invariants and Proof

**Theorem 2.1 (Lomuto partition correctness).** After `PARTITION(A, lo, hi)` with pivot `v = A[hi]` returns `p`:
1. `A[p] = v`,
2. `A[m] ≤ v` for all `lo ≤ m < p`,
3. `A[m] > v` for all `p < m ≤ hi`,
4. the subarray `A[lo..hi]` is a permutation of its original contents.

**Lomuto algorithm.**
```
PARTITION(A, lo, hi):
  v = A[hi]; i = lo - 1
  for j = lo to hi - 1:
    if A[j] <= v:
      i = i + 1; swap(A[i], A[j])
  swap(A[i+1], A[hi])
  return i + 1
```

**Proof (loop invariant).** Maintain, at the start of each iteration with loop index `j`, the invariant **`Inv(j)`**:

```
(a) A[m] <= v   for all  lo <= m <= i          (the "small" region)
(b) A[m] >  v   for all  i < m <= j - 1         (the "large" region)
(c) A[hi] = v                                   (pivot untouched until the end)
```

*Initialization.* Before the first iteration `j = lo`, we have `i = lo - 1`, so region (a) `[lo..i] = [lo..lo-1]` is empty (vacuously true) and region (b) `[i+1..j-1] = [lo..lo-1]` is empty (vacuously true); (c) holds since the pivot has not moved. `Inv(lo)` holds.

*Maintenance.* Assume `Inv(j)`. Two cases:
- `A[j] > v`: no swap, `i` unchanged, `j` increments. Element `A[j]` joins region (b), which still contains only elements `> v`. (a) is untouched. `Inv(j+1)` holds.
- `A[j] ≤ v`: increment `i`, then `swap(A[i], A[j])`. Before the swap, `A[i]` was the first element of region (b) (`> v`) and `A[j] ≤ v`. After the swap, `A[i] ≤ v` extends region (a), and the displaced `> v` element lands at `A[j]`, which is about to leave region (b) as `j` increments — so region (b) `[i+1..j]` still holds only `> v` elements. `Inv(j+1)` holds.

*Termination.* The loop ends at `j = hi`. `Inv(hi)` gives: `A[lo..i] ≤ v`, `A[i+1..hi-1] > v`, and `A[hi] = v`. The final `swap(A[i+1], A[hi])` moves the pivot to index `i+1`, sending the `> v` element at `A[i+1]` to the end (still `> v`). Setting `p = i+1`: claim (1) `A[p] = v` ✓; (2) `A[lo..p-1] ≤ v` ✓; (3) `A[p+1..hi] > v` ✓ (the old `A[i+1..hi-1]` plus the swapped element, all `> v`). Each step is a swap or no-op, so (4) the permutation property holds. ∎

**Corollary 2.2 (Pivot is finally placed).** Since `A[p] = v`, everything left is `≤ v`, everything right is `> v`, the pivot at `p` is in its final sorted position and is never moved by subsequent recursion (which operates on `[lo..p-1]` and `[p+1..hi]`, both excluding `p`). This is why quicksort needs **no merge step**: each partition permanently fixes at least one element.

**Hoare variant.** Hoare's partition returns a split point `q` with `A[lo..q] ≤ A[q+1..hi]` elementwise-by-region (not a single fixed pivot index). Its invariant is that the left pointer only stops on elements `≥ v` and the right only on `≤ v`, so when they cross, everything left of the crossing is `≤ v` and everything right is `≥ v`. The recursion is on `(lo, q)` and `(q+1, hi)`; correctness follows by the same region argument, with the subtlety that the pivot is **not** necessarily at `q`, so neither recursive call may exclude it — hence `(lo, q)`, not `(lo, q-1)`.

---

## 3. Three-Way Partition Correctness (Dutch National Flag)

**Theorem 3.1.** The Dutch-National-Flag partition rearranges `A[lo..hi]` and returns `(lt, gt)` such that `A[lo..lt-1] < v`, `A[lt..gt] = v`, `A[gt+1..hi] > v`, and the subarray is a permutation of its original contents.

**Algorithm.**
```
THREE-WAY(A, lo, hi):           # v = A[lo]
  v = A[lo]; lt = lo; i = lo; gt = hi
  while i <= gt:
    if   A[i] < v: swap(A[lt], A[i]); lt++; i++
    elif A[i] > v: swap(A[i], A[gt]); gt--
    else:          i++
  return (lt, gt)
```

**Proof (loop invariant).** Maintain `Inv`:

```
A[lo..lt-1] <  v       (the "less" region)
A[lt..i-1]  == v       (the "equal" region)
A[i..gt]    unknown     (not yet scanned)
A[gt+1..hi] >  v       (the "greater" region)
```

*Initialization.* `lt = i = lo`, `gt = hi`: "less" `[lo..lo-1]` empty, "equal" `[lo..lo-1]` empty, "greater" `[hi+1..hi]` empty, unknown `[lo..hi]` is the whole range. `Inv` holds.

*Maintenance.* While `i ≤ gt`, inspect `A[i]`:
- `A[i] < v`: `swap(A[lt], A[i])`. The element at `lt` was `== v` (first of the equal region) or, if equal region empty, `lt = i`. After swap, `A[lt] < v` extends "less", the displaced `== v` element moves to `A[i]`; increment both `lt, i`, so it joins the end of "equal". `Inv` preserved.
- `A[i] > v`: `swap(A[i], A[gt])`, `gt--`. The element from `gt` (previously unknown) is now at `A[i]` and **must be re-examined**, so `i` is **not** incremented; the `> v` element extends "greater". `Inv` preserved. *This non-increment of `i` is the crux.*
- `A[i] == v`: increment `i`, extending "equal". `Inv` preserved.

*Termination.* When `i > gt`, the unknown region `[i..gt]` is empty. `Inv` gives exactly the three claimed regions. Every operation is a swap, so the permutation property holds. ∎

**Corollary 3.2 (All-equal is linear).** If every element equals `v`, every iteration takes the `== v` branch, advancing `i` once per element: one `O(n)` pass, and the recursion on `[lo..lt-1] = ∅` and `[gt+1..hi] = ∅` is empty. Thus three-way quicksort sorts an all-equal array in `O(n)`, versus `O(n²)` for two-way Lomuto. More generally, with `d` distinct keys the recursion depth is `O(d)` and the total cost is `O(n log d)` — the **entropy-optimal** bound for sorting with duplicate keys (Sedgewick-Bentley).

---

## 4. The Quicksort Recurrence and Worst-Case Proof

Let `T(n)` be the number of comparisons quicksort makes on an `n`-element array. A partition of `n` elements uses exactly `n - 1` comparisons (each non-pivot compared once to the pivot). If the pivot has rank `i` (so the left side has `i` elements and the right has `n - 1 - i`):

```
T(n) = T(i) + T(n - 1 - i) + (n - 1),     T(0) = T(1) = 0.
```

**Theorem 4.1 (Worst case).** `T_worst(n) = Θ(n²)`.

**Proof.** The worst split has `i = 0` or `i = n-1` every time (the pivot is always the min or max). Then

```
T(n) = T(0) + T(n-1) + (n-1) = T(n-1) + (n-1).
```

Unrolling: `T(n) = Σ_{m=1}^{n-1} m = n(n-1)/2 = Θ(n²)`. To show this is the *maximum*, prove `T(n) ≤ c n²` by induction: `T(n) = max_i [T(i) + T(n-1-i)] + (n-1)`. The function `f(i) = i² + (n-1-i)²` is convex and maximized at the endpoints `i ∈ {0, n-1}`, giving `(n-1)²`. Hence `T(n) ≤ c(n-1)² + (n-1) ≤ c n²` for suitable `c`. So `T_worst(n) = Θ(n²)`. ∎

**When the worst case occurs.** A deterministic last-element pivot achieves this on an **already-sorted** (or reverse-sorted) array: each pivot is the maximum, peeling off one element per level, `n` levels deep. This is not a pathological hand-crafted input — it is the *common* case of pre-sorted data, which is precisely why a fixed pivot is unacceptable in practice (Section 5 removes the dependence on input order via randomization).

**Theorem 4.2 (Worst case is unavoidable for some input, any deterministic pivot rule).** For any deterministic pivot-selection rule that inspects `O(1)` elements, there exists an input forcing `Ω(n²)`. Sketch: an adaptive adversary (McIlroy 1999, see `senior.md`) answers comparisons so that whichever element the rule picks is always extreme. Hence randomization (or a linear-time median pivot, Section 8) is *necessary* to escape `O(n²)` on adversarial input.

---

## 5. Expected-Comparison Analysis of Randomized Quicksort

This is the central theorem of the topic. Randomized quicksort picks the pivot uniformly at random from the subarray.

**Theorem 5.1.** The expected number of comparisons made by randomized quicksort on `n` distinct elements is

```
E[T(n)] = 2(n+1)H_n - 4n = 2n ln n + Θ(n) ≈ 1.386 n log₂ n,
```

where `H_n = Σ_{m=1}^{n} 1/m` is the `n`-th harmonic number.

**Proof (indicator variables — the elegant CLRS argument).** Let the sorted order of the elements be `z_1 < z_2 < … < z_n`, where `z_i` is the element of rank `i`. Define the indicator

```
X_{ij} = 1   if z_i and z_j are ever compared during the sort,  else 0   (i < j).
```

Every comparison in quicksort is between some element and a pivot, and **two elements are compared at most once** (once one becomes a pivot, it is removed from future subproblems). So the total number of comparisons is

```
T = Σ_{i<j} X_{ij},   hence   E[T] = Σ_{i<j} Pr[z_i and z_j are compared].
```

**Key claim:** `z_i` and `z_j` (with `i < j`) are compared **iff** the *first* pivot chosen from the set `Z_{ij} = {z_i, z_{i+1}, …, z_j}` is either `z_i` or `z_j`.

*Why:* Consider the set `Z_{ij}` of all elements whose rank is between `i` and `j` inclusive. As recursion proceeds, at some point a pivot is chosen from `Z_{ij}` for the first time (before that, all of `Z_{ij}` lies in one subarray, since any pivot outside `Z_{ij}` is either `< z_i` or `> z_j` and sends all of `Z_{ij}` to the same side without comparing `z_i` to `z_j`).
- If that first pivot is `z_i` or `z_j`, then `z_i` and `z_j` *are* compared (the pivot is compared to every other element of `Z_{ij}`, including the other endpoint).
- If that first pivot is some `z_m` with `i < m < j`, then `z_i` goes left of `z_m`, `z_j` goes right, they are separated into different subarrays and are **never** compared.

The first pivot from `Z_{ij}` is uniformly random among its `|Z_{ij}| = j - i + 1` elements, so

```
Pr[z_i, z_j compared] = Pr[first pivot in Z_{ij} is z_i or z_j] = 2 / (j - i + 1).
```

Therefore

```
E[T] = Σ_{i=1}^{n-1} Σ_{j=i+1}^{n}  2/(j - i + 1).
```

Substitute `k = j - i` (so `k` ranges `1 … n-i`):

```
E[T] = Σ_{i=1}^{n-1} Σ_{k=1}^{n-i} 2/(k+1)
     < Σ_{i=1}^{n-1} Σ_{k=1}^{n}   2/k          (extend the inner sum)
     = Σ_{i=1}^{n-1} 2 H_n  =  2(n-1) H_n  =  O(n log n).
```

The exact closed form `E[T] = 2(n+1)H_n - 4n` follows by evaluating the double sum precisely. Using `H_n = ln n + γ + O(1/n)`:

```
E[T] = 2n ln n + O(n) = (2/ln 2) n log₂ n + O(n) ≈ 1.386 n log₂ n. ∎
```

**Interpretation.** The harmonic-number `Σ 2/(j-i+1)` is the heart of the proof: *distant ranks are rarely compared* (probability `2/(j-i+1)` shrinks as the gap grows), and summing these probabilities yields `O(n log n)`. The constant `1.386` means randomized quicksort makes about 39% more comparisons than the information-theoretic minimum `n log₂ n` — but with a far smaller per-comparison constant than merge sort, it wins wall-clock time.

**Crucial point about randomization.** The expectation is over the algorithm's **internal coin flips**, *not* over a distribution of inputs. So `E[T(n)] = O(n log n)` holds for **every** input, including adversarial ones — the input cannot be "bad" because the pivots are random. This is the precise sense in which randomized quicksort defeats the worst case.

---

## 6. Best Case and the Balanced-Split Recurrence

**Theorem 6.1 (Best case).** If every partition splits `n-1` non-pivot elements as evenly as possible (`⌊(n-1)/2⌋` and `⌈(n-1)/2⌉`), then `T(n) = 2T(n/2) + Θ(n) = Θ(n log n)`.

**Proof.** This is case 2 of the Master Theorem (`a = 2, b = 2, f(n) = Θ(n)`, `n^{log_b a} = n`), giving `Θ(n log n)`. ∎

**Theorem 6.2 (Constant-fraction splits suffice).** If every split is at worst a `(1-α) : α` ratio for some fixed `0 < α ≤ 1/2` (e.g. 9:1, `α = 0.1`), then `T(n) = O(n log n)` still.

**Proof.** The recursion tree has depth at most `log_{1/(1-α)} n` (the larger fraction is `1-α < 1`, so size shrinks geometrically), and each level does `O(n)` partition work, totaling `O(n · log_{1/(1-α)} n) = O(n log n)` (the base of the log is a constant). ∎

**Significance.** Quicksort does **not** need perfectly balanced splits for `O(n log n)`; it only needs to avoid splits that are unbalanced *every single time*. Even a 99:1 split at every level is `O(n log n)` (with a larger constant). This robustness is why a randomized pivot — which gives a balanced-enough split with overwhelming probability — works so well. The worst case requires the adversary (or bad luck) to hit a near-extreme split at *every* level simultaneously, an event randomization makes negligibly likely (Section 11).

---

## 7. Quickselect: Expected O(n) Proof

Quickselect finds the element of rank `k` by partitioning and recursing into only the side containing `k`.

**Theorem 7.1.** Randomized quickselect runs in expected `O(n)` time.

**Proof (expected linear, via the recurrence).** Let `T(n)` bound the expected comparisons to select from `n` elements. A partition costs `n - 1` comparisons and produces a pivot of uniformly random rank. After partitioning, we recurse into one side. The worst case over which rank `k` we seek is bounded by recursing into the *larger* of the two sides. If the pivot has rank `i` (uniform in `0..n-1`), the larger side has `max(i, n-1-i)` elements. Then

```
E[T(n)] <= (n-1) + (1/n) Σ_{i=0}^{n-1} T(max(i, n-1-i)).
```

The term `max(i, n-1-i)` ranges over `⌈n/2⌉ … n-1`, with each value hit at most twice, so

```
E[T(n)] <= (n-1) + (2/n) Σ_{m=⌊n/2⌋}^{n-1} T(m).
```

**Guess `T(n) ≤ cn` and verify by induction.** Assume `T(m) ≤ cm` for `m < n`:

```
E[T(n)] <= (n-1) + (2c/n) Σ_{m=⌊n/2⌋}^{n-1} m.
```

The sum `Σ_{m=⌊n/2⌋}^{n-1} m ≤ (3/8) n²` (it is the sum of the upper half of `0..n-1`). So

```
E[T(n)] <= (n-1) + (2c/n)(3 n²/8) = (n-1) + (3c/4) n.
```

For this to be `≤ cn`, need `(n-1) + (3c/4) n ≤ cn`, i.e. `(n-1) ≤ (c/4) n`, which holds for `c ≥ 4` and `n ≥ 1`. Hence `E[T(n)] ≤ 4n = O(n)`. ∎

**Intuition (geometric series).** A random pivot splits off, on average, a constant fraction. The expected sizes of the recursed subproblems shrink geometrically: `n, (3/4)n, (3/4)²n, …`, and the partition costs `n + (3/4)n + (9/16)n + … = n · 1/(1 - 3/4) = 4n`. Quicksort recurses into *both* sides (the costs at each level sum to `n`, repeated `log n` times → `n log n`); quickselect recurses into *one* side (the costs form a *decreasing geometric series* that sums to `O(n)`). **Dropping one recursive call collapses the `log n` factor into a constant.**

**Worst case.** Like quicksort, quickselect's worst case is `O(n²)` (adversarial or unlucky pivots always extreme). Section 8 removes this.

---

## 8. Median-of-Medians: Worst-Case O(n) Selection

The BFPRT algorithm (Blum, Floyd, Pratt, Rivest, Tarjan, 1973) chooses a *provably good* pivot in linear time, giving **deterministic worst-case `O(n)`** selection.

**Algorithm `SELECT(A, k)`:**
1. Divide the `n` elements into `⌈n/5⌉` groups of 5 (last group may be smaller).
2. Sort each group (`O(1)` each) and take its median → `⌈n/5⌉` medians.
3. Recursively `SELECT` the median **of these medians**, call it `x`.
4. Partition `A` around `x`; recurse into the side containing rank `k`.

**Theorem 8.1.** `SELECT` runs in worst-case `O(n)`.

**Proof.** The pivot `x` (median of medians) is guaranteed to be larger than at least `3⌈⌈n/5⌉/2⌉ ≈ 3n/10` elements and smaller than at least `≈ 3n/10`. Reason: half of the `⌈n/5⌉` group-medians are `≤ x`, and each such group contributes 3 elements (the median and the two smaller) that are `≤ x`. Symmetrically for the larger side. Thus each recursive partition discards at least `~3n/10` elements, so the side we recurse into has at most `~7n/10` elements. The recurrence is

```
T(n) <= T(n/5)        # step 3: select median of medians
      + T(7n/10)      # step 4: recurse into the larger possible side
      + O(n)          # grouping, group-sorts, partition
```

Because `1/5 + 7/10 = 9/10 < 1`, the subproblem sizes sum to a *fraction less than 1* of `n`. Substituting `T(n) ≤ cn`: `T(n) ≤ c n/5 + 7cn/10 + an = (9c/10) n + an ≤ cn` whenever `c ≥ 10a`. Hence `T(n) = O(n)`. ∎

**The "groups of 5" choice.** Groups of 5 are the smallest that make `1/5 + 7/10 < 1`. Groups of 3 give `1/3 + 2/3 = 1`, which does *not* solve to linear (the recurrence becomes `Θ(n log n)`); groups of 7 also work but with worse constants. Five is the textbook optimum.

**Practical note.** The constant in median-of-medians is large (~`O(n)` with a big factor), so randomized quickselect (expected `O(n)`, tiny constant) is faster in practice. Median-of-medians is used as a **guard** (introselect) to bound the worst case, mirroring introsort's heapsort guard for sorting.

---

## 9. Stack-Space and Tail-Recursion Bounds

**Theorem 9.1.** With the "recurse into the smaller side, iterate on the larger" transformation, quicksort uses `O(log n)` stack space in the worst case.

**Proof.** Each recursive call handles the smaller partition, which has at most `⌊(size-1)/2⌋ < size/2` elements. So along any chain of recursive calls the subproblem size at least halves each time, bounding the recursion depth by `⌊log₂ n⌋`. The larger side is handled by the enclosing loop (`lo = p+1` or `hi = p-1`), consuming no additional stack frame. Hence stack space is `O(log n)` regardless of pivot quality. ∎

**Contrast.** Naive recursion on *both* sides without small-side-first can reach depth `Θ(n)` (when the smaller side is always size 0 or 1), risking stack overflow on large inputs even though the *time* bound is unchanged. The transformation decouples stack depth (made `O(log n)` unconditionally) from time (still `O(n²)` worst case until randomization/introsort fixes that).

---

## 10. Stability and the Comparison-Sort Lower Bound

**Proposition 10.1 (Quicksort is not stable).** The partition swaps can reorder elements that compare equal. Concretely, with Lomuto on `[(2,a), (2,b), (1,c)]` keyed on the first coordinate, the partition moves `(1,c)` left and can place `(2,b)` before `(2,a)`, inverting their original order. No in-place two-way partition that swaps non-adjacent elements can be stable in general; stability requires either extra space (tag with original index) or a stable merge-based sort. ∎

**Theorem 10.2 (Comparison-sort lower bound).** Any comparison sort makes `Ω(n log n)` comparisons in the worst case.

**Proof (decision tree).** A comparison sort is a binary decision tree: each internal node is a comparison with two outcomes, each leaf a permutation. To sort correctly, every one of the `n!` input permutations must reach a distinct leaf, so the tree has `≥ n!` leaves. A binary tree of height `h` has `≤ 2^h` leaves, so `2^h ≥ n!`, giving `h ≥ log₂(n!) = Θ(n log n)` by Stirling (`log₂(n!) = n log₂ n - n log₂ e + O(log n)`). The height `h` is the worst-case comparison count. ∎

**Consequence for quicksort.** Randomized quicksort's `≈ 1.386 n log₂ n` expected comparisons is within a constant factor `1.386` of this `n log₂ n` lower bound — asymptotically optimal. The gap is the price of partitioning rather than perfectly halving; merge sort attains `≈ n log₂ n` comparisons (closer to optimal) but with larger per-operation constants and `O(n)` space.

**Beating the bound.** Non-comparison sorts (counting, radix, bucket) break `Ω(n log n)` by exploiting key structure, sorting in `O(n)` or `O(nk)` — but they are not comparison sorts and do not apply to arbitrary comparable types. Three-way quicksort's `O(n log d)` for `d` distinct keys (Corollary 3.2) does **not** violate the bound: it is `O(n log n)` when `d = n`, and the `log d` improvement comes from the multiset structure (duplicates), a refinement of the lower bound for inputs with repeated keys.

---

## 11. Concentration: Why Quadratic Is Astronomically Unlikely

The expectation `E[T] = O(n log n)` (Section 5) says the *average* is good, but a risk-averse engineer wants to know the *tail*: how likely is randomized quicksort to be much slower than its mean?

**Theorem 11.1 (High-probability bound).** Randomized quicksort runs in `O(n log n)` time **with high probability**: `Pr[T(n) > c n log n] ≤ n^{-d}` for constants `c, d` that can be made large. Equivalently, the recursion depth exceeds `O(log n)` with probability polynomially small in `n`.

**Proof sketch (depth concentration).** Fix one element `x`. Track the subproblem containing `x` down the recursion. A pivot is "good" for this subproblem if it lands `x` in a side of size at most `3/4` of the current size; a uniformly random pivot is good with probability `≥ 1/2` (the pivot's rank falls in the middle half). After at most `log_{4/3} n` good pivots, the subproblem containing `x` has size 1. The number of pivots needed is a sum of geometric waits; by a Chernoff bound on the number of good vs bad pivots in a chain of length `α log n`, the probability that fewer than `log_{4/3} n` are good is `≤ n^{-d}`. A union bound over all `n` elements keeps the failure probability polynomially small. Hence the depth — and therefore the total work — is `O(n log n)` w.h.p. ∎

**Consequence.** The `O(n²)` worst case, while real, occurs with probability that *vanishes super-polynomially* in `n`. For `n = 10^6`, the chance that randomized quicksort takes anywhere near quadratic time is smaller than the chance of a hardware failure mid-sort. Combined with the introsort depth guard (which makes the worst case `O(n log n)` *deterministically*), randomized quicksort is both fast in expectation and safe in the tail — the theoretical justification for its ubiquity.

**Variance note.** The variance of the comparison count is `Θ(n²)` (dominated by rare unlucky runs), so the *standard deviation* is `Θ(n)`, small relative to the `Θ(n log n)` mean. The distribution is tightly concentrated around its mean — the practical meaning of "expected `O(n log n)`."

---

## 12. Solving the Average-Case Recurrence Directly

The indicator-variable proof (Section 5) is the elegant route, but the *recurrence* route is worth seeing because it reproduces the same `2(n+1)H_n - 4n` and shows the harmonic number emerging from a telescoping sum rather than from probabilities.

**Setup.** With a uniformly random pivot, the pivot's rank is uniform on `{0, 1, …, n-1}`. Conditioning on rank `i`, the two subproblems have sizes `i` and `n-1-i`, so

```
E[T(n)] = (n - 1) + (1/n) Σ_{i=0}^{n-1} ( E[T(i)] + E[T(n-1-i)] ).
```

Both sums range over the same set of sizes `0 … n-1`, so they are equal:

```
E[T(n)] = (n - 1) + (2/n) Σ_{i=0}^{n-1} E[T(i)].
```

**The telescoping trick.** Let `S(n) = Σ_{i=0}^{n-1} E[T(i)]`. Multiply through by `n`:

```
n · E[T(n)] = n(n - 1) + 2 S(n).        (★)
```

Write the same identity for `n-1`:

```
(n-1) · E[T(n-1)] = (n-1)(n-2) + 2 S(n-1).    (★★)
```

Subtract (★★) from (★), using `S(n) - S(n-1) = E[T(n-1)]`:

```
n·E[T(n)] - (n-1)·E[T(n-1)] = n(n-1) - (n-1)(n-2) + 2 E[T(n-1)]
                            = 2(n-1) + 2 E[T(n-1)].
```

Rearranging:

```
n · E[T(n)] = (n+1) E[T(n-1)] + 2(n-1).
```

**Divide by `n(n+1)`** to make it telescope (the standard summation-factor technique). Let `U(n) = E[T(n)] / (n+1)`:

```
U(n) = U(n-1) + 2(n-1) / ( n(n+1) ).
```

Summing from `2` to `n` (with `U(1) = 0`):

```
U(n) = Σ_{m=2}^{n} 2(m-1)/(m(m+1)).
```

A partial-fraction decomposition `2(m-1)/(m(m+1)) = -2/m + 4/(m+1)`... more cleanly, the standard evaluation gives `U(n) = 2 H_{n+1} - 4n/(n+1) + Θ(1/n)`, hence

```
E[T(n)] = (n+1) U(n) = 2(n+1) H_n - 4n,
```

matching Theorem 5.1 exactly. **The harmonic number `H_n` is intrinsic to quicksort's average case**, arising here from the summation-factor telescoping of the recurrence and, in Section 5, from `Σ 2/(j-i+1)`. Two derivations, one constant `2(n+1)H_n - 4n ≈ 1.386 n log₂ n`.

**Corollary 12.1 (Expected swaps, Lomuto).** Counting swaps instead of comparisons, the same conditioning gives an expected swap count of `Θ(n log n)` but with a *larger* constant than Hoare, because Lomuto swaps once per element `≤ pivot` (about half the elements per partition) whereas Hoare swaps only out-of-place pairs (about a sixth). This `~3×` swap ratio is the quantitative reason library implementations prefer Hoare-style or block partitioning over textbook Lomuto.

---

## 13. Dual-Pivot Quicksort: Why Two Pivots Help

Java's primitive `Arrays.sort` uses Yaroslavskiy's **dual-pivot** scheme. Two pivots `p1 ≤ p2` split into three regions in one pass. The natural question: does the extra pivot actually reduce comparisons?

**Theorem 13.1 (Dual-pivot average comparisons).** Classic (single-pivot) randomized quicksort uses `≈ 2 n ln n` comparisons on average. Yaroslavskiy's dual-pivot quicksort uses `≈ 1.9 n ln n` comparisons on average — a `~5%` reduction in comparisons, and a larger reduction in cache misses.

**Why fewer.** A three-way split from two pivots produces subproblems of expected size `≈ n/3` each, so the recursion is shallower (`log₃ n` levels vs `log₂ n`), and each element is, on average, compared against a pivot fewer times across its lifetime. The detailed accounting (Wild-Nebel, 2012) shows the constant drops from `2` to `1.9` for comparisons; the *swap* count is slightly higher, but on modern hardware the dominant cost is **cache misses**, and the three-way partition's better locality is the real win — which is why JDK measured a speedup on primitive arrays and adopted it.

**Caveat (the theory surprise).** The reason dual-pivot wins was initially mysterious: naive analysis predicted it should be *worse*. Wild and Nebel's precise average-case analysis (2012) resolved it, showing the comparison constant genuinely drops. This is a rare case where a practical engineering choice (made by a non-academic, Vladimir Yaroslavskiy, from benchmarks) outran the existing theory and prompted new analysis. The lesson: the asymptotic `O(n log n)` is identical, but **constant factors are real, measurable, and worth analyzing** — the entire reason for the dual-pivot, branchless, and three-way refinements.

**k-pivot generalization.** One can use `k` pivots and `k+1` regions. The comparison constant continues to improve slowly as `k` grows, but the partition logic becomes complex and the cache benefit saturates, so `k = 2` (dual-pivot) is the practical sweet spot. This mirrors the median-of-medians "groups of 5" optimum: the theory admits a family, but a small constant choice dominates in practice.

---

## 14. Median-of-Three: How Much Does It Help?

Median-of-three pivot selection (median of `a[lo]`, `a[mid]`, `a[hi]`) is the most common practical pivot rule. Its average-case improvement is quantifiable.

**Theorem 14.1.** Quicksort with the median-of-three pivot rule makes `≈ (12/7) n ln n ≈ 1.714 n ln n` comparisons on average, versus `2 n ln n` for a single random pivot — a `~14%` reduction.

**Why.** Taking the median of three random samples biases the pivot's rank toward the center of the array. The pivot rank, instead of being uniform on `[0, n-1]`, follows a `Beta(2,2)`-shaped distribution (the density of the median of 3 uniforms is `6x(1-x)` on `[0,1]`), which concentrates around `1/2`. More central pivots mean more balanced splits, lowering the expected depth and comparison count. The exact constant `12/7` comes from integrating the recurrence against this density (Sedgewick 1975).

**The diminishing-returns curve.** Median-of-`(2t+1)` samples drives the pivot-rank distribution toward a spike at the true median as `t → ∞`, and the comparison constant approaches the information-theoretic optimum `n log₂ n` (i.e. `(1/ln 2) n ln n ≈ 1.386 n log₂ n` comparisons). But the sampling cost grows with `t`. **Median-of-three is the sweet spot**: it captures most of the benefit (`14%`) for `O(1)` extra comparisons. The "ninther" (median of three medians-of-three, used on large arrays by Bentley-McIlroy) pushes further for big `n`, where the extra samples pay off.

**Adversarial caveat (the theory limit).** None of this changes the *worst case*: median-of-three is still `Θ(n²)` on the McIlroy killer input (Section 4, Theorem 4.2), because the adversary defeats any deterministic `O(1)`-sample rule. The average-case constant improvement and the worst-case bound are independent facts — improving the former does not touch the latter, which is why a worst-case guarantee needs randomization (input-independent expectation) or median-of-medians (linear-time exact median), not better fixed sampling.

---

## 15. Quickselect Variance and the Floyd-Rivest Refinement

**Variance of quickselect.** Randomized quickselect's expected comparison count is `2n + 2k ln(n/k) + 2(n-k) ln(n/(n-k)) + O(n)` to find rank `k` — maximized near the median (`k = n/2`), where it is `≈ (2 + 2 ln 2) n ≈ 3.39 n`, and minimized at the extremes (`k = 0` or `n-1`), where it approaches `2n`. So finding the **median** is the hardest selection, the **min/max** the easiest — matching intuition (the min needs essentially one pass, the median needs the most "narrowing").

**Floyd-Rivest (1975).** A refinement of quickselect that, to find rank `k`, recursively selects a *small random sample* and uses two pivots bracketing the expected position of rank `k`, so that after one partition the remaining subproblem is of size `O(√n)` with high probability. This achieves `n + min(k, n-k) + O(√n)` expected comparisons — provably **optimal up to lower-order terms** (it matches the `n + min(k, n-k) - O(1)` lower bound for comparison-based selection). It is the algorithm of choice when the constant in selection truly matters (e.g. repeated median-finding in computational geometry).

**Lower bound for selection.** Finding the median requires at least `(2 + ε) n` comparisons in the worst case (Bent-John 1985, with the best lower bound near `2n`), and at least `n - 1` comparisons to find the minimum (each non-min element must "lose" at least once). Quickselect's expected `O(n)` and Floyd-Rivest's `n + min(k,n-k) + o(n)` are within these bounds — selection is genuinely cheaper than sorting (`Θ(n)` vs `Θ(n log n)`), the formal reason you should never sort just to find one order statistic.

---

## 16. The Recursion Tree, Visually

The `O(n log n)` average and `O(n²)` worst case are most intuitive as a **recursion tree** where each node is labeled with the partition cost (`size - 1` comparisons) and the tree's total label-sum is the running time.

**Balanced (best/average) tree.**

```
level 0:        [n]                         cost ≈ n
level 1:    [n/2]   [n/2]                    cost ≈ n      (two nodes, n/2 each)
level 2:  [n/4][n/4][n/4][n/4]               cost ≈ n
   …                                          …
level log n: [1][1] … [1]                    cost ≈ n
                                            -----------
                              total ≈ n · (number of levels) = n · log₂ n
```

Every level sums to `≈ n` (the partition work is proportional to the total elements at that level, which is always `≤ n`), and there are `log₂ n` levels because the size halves each level. Product: `n log₂ n`.

**Degenerate (worst-case) tree.**

```
level 0:  [n]                cost ≈ n
level 1:  [n-1]              cost ≈ n-1     (one side empty)
level 2:  [n-2]              cost ≈ n-2
   …
level n-1:[1]                cost ≈ 1
                            -----------
              total ≈ n + (n-1) + … + 1 = n(n+1)/2 = Θ(n²)
```

The tree degenerates into a *path* of depth `n`, and the level costs form an arithmetic series summing to `Θ(n²)`. **The entire average-vs-worst gap is the difference between a balanced tree (depth `log n`, each level `n`) and a path (depth `n`, levels shrinking by 1).** The harmonic-number analysis (Section 5) is precisely the statement that, with random pivots, the *expected* tree has depth `Θ(log n)` and behaves like the balanced picture with high probability (Section 11).

**Quickselect's tree** is a single path (one child per node), with node costs `n, ≤(3/4)n, ≤(9/16)n, …` — a *geometric* (not arithmetic) decay, summing to `O(n)`. Comparing the two pictures side by side is the clearest way to see why dropping one recursive call turns `Θ(n log n)` into `Θ(n)`.

---

## 17. The Entropy Lower Bound for Sorting with Duplicates

Three-way quicksort's `O(n log d)` (Corollary 3.2) is not merely a nice optimization — it is **optimal** for sorting a multiset, and the matching lower bound is information-theoretic.

**Setup.** Suppose the `n` elements take `d` distinct values with multiplicities `n_1, n_2, …, n_d` (so `Σ n_i = n`). Let `p_i = n_i / n` be the frequency of value `i`.

**Theorem 17.1 (Multiset sorting lower bound).** Any comparison-based sort of such a multiset requires at least

```
n · H(p_1, …, p_d) - O(n)   comparisons,   where  H = -Σ_i p_i log₂ p_i
```

is the Shannon entropy of the value distribution.

**Proof (decision tree, refined).** The number of *distinguishable* arrangements of the multiset is the multinomial coefficient `n! / (n_1! n_2! … n_d!)`. A correct sort must reach a distinct leaf for each, so the decision tree has `≥ n!/(Π n_i!)` leaves, giving height `≥ log₂(n!/Π n_i!)`. By Stirling, `log₂(n!/Π n_i!) = n H(p_1,…,p_d) - O(d log n)`. So `Ω(n H)` comparisons are necessary. ∎

**Matching upper bound.** Three-way quicksort achieves `O(n H)` expected comparisons: each distinct value becomes a pivot at most once, and the recursion's expected cost telescopes to `Σ_i n_i log(n/n_i) = n H` (Sedgewick-Bentley 1998). When all values are distinct (`d = n`, each `p_i = 1/n`), `H = log₂ n` and the bound reduces to the familiar `n log₂ n`. When there are few distinct values (small `d`), `H ≤ log₂ d` is much smaller, and three-way quicksort exploits exactly this.

**Significance.** This certifies that three-way partitioning is *entropy-optimal*: no comparison sort can beat `n H` on a multiset, and three-way quicksort attains it. It is the rigorous reason the Dutch-National-Flag refinement is not just a hack for the all-equal pathology but the asymptotically right algorithm for any duplicate-heavy input — the same way the `Ω(n log n)` bound (Section 10) certifies plain quicksort optimal for distinct keys.

---

## 18. Summary

- **Partition correctness** rests on loop invariants: Lomuto maintains a `≤ pivot` prefix region and places the pivot in its final slot (Theorem 2.1); three-way DNF maintains four regions and isolates equal keys in one pass (Theorem 3.1), giving `O(n log d)` for `d` distinct keys.
- **The recurrence** `T(n) = T(i) + T(n-1-i) + (n-1)` yields `Θ(n²)` worst case (convex maximum at extreme splits, Theorem 4.1) — provably hit by a fixed pivot on sorted input, and unavoidable for any deterministic pivot rule against an adversary (Theorem 4.2).
- **Randomized expected analysis** is the centerpiece: indicator variables `X_{ij}` give `Pr[z_i, z_j compared] = 2/(j-i+1)`, and the harmonic sum `Σ 2/(j-i+1)` evaluates to `2(n+1)H_n - 4n ≈ 1.386 n log₂ n` (Theorem 5.1). The expectation is over coin flips, so it holds for **every** input.
- **Balanced-split robustness:** any constant-fraction split (even 99:1) is `O(n log n)` (Theorem 6.2); perfect halving is not required.
- **Quickselect** recurses into one side; its partition costs form a geometric series summing to `O(n)` expected (Theorem 7.1). **Median-of-medians** (groups of 5, `T(n) ≤ T(n/5) + T(7n/10) + O(n)`) makes selection worst-case `O(n)` (Theorem 8.1).
- **Stack space** is `O(log n)` with small-side-first recursion (Theorem 9.1), decoupling depth from the `O(n²)` time risk.
- **Lower bound:** any comparison sort needs `Ω(n log n)` comparisons (decision-tree / Stirling, Theorem 10.2); randomized quicksort is within `1.386×` of optimal. Quicksort is **not stable** (Proposition 10.1).
- **Concentration:** the quadratic case is super-polynomially unlikely (Theorem 11.1), and the comparison count is tightly concentrated (std dev `Θ(n)` ≪ mean `Θ(n log n)`).

### Complexity Cheat Table

| Quantity | Value | Reference |
|----------|-------|-----------|
| Partition | `Θ(n)` comparisons, in place | §2 |
| Quicksort average | `2(n+1)H_n - 4n ≈ 1.386 n log₂ n` | §5 |
| Quicksort worst | `Θ(n²)` | §4 |
| Quicksort best | `Θ(n log n)` | §6 |
| Three-way, `d` distinct keys | `O(n log d)` | §3 |
| Quickselect expected | `O(n)` | §7 |
| Quickselect worst (median-of-medians) | `O(n)` | §8 |
| Stack space (small-side-first) | `O(log n)` | §9 |
| Comparison-sort lower bound | `Ω(n log n)` | §10 |

| Multiset entropy lower bound | `Ω(n H)`, attained by three-way | §17 |
| Median-of-three average | `≈ 1.714 n ln n` | §14 |
| Dual-pivot average | `≈ 1.9 n ln n` | §13 |
| Floyd-Rivest selection | `n + min(k, n-k) + o(n)` | §15 |

### Closing Notes

- **The harmonic sum** (Section 5), reproduced via the recurrence's summation-factor telescoping (Section 12), is the single most important derivation: it explains *why* random pivots give `O(n log n)` and quantifies the `1.386` constant. Two independent routes yield the same `2(n+1)H_n - 4n`.
- **Dropping one recursion** (Section 7) is the structural reason quickselect is `O(n)` while quicksort is `O(n log n)` — a *geometric* series of partition costs instead of `log n` equal-cost levels. The recursion-tree pictures (Section 16) make this visible: a path with geometric decay vs a balanced tree with constant level-sums.
- **Concentration** (Section 11) upgrades "good on average" to "good with overwhelming probability," the theoretical license for using a randomized algorithm in production.
- **The lower bounds** certify optimality: `Ω(n log n)` for distinct keys (Section 10) and the sharper `Ω(n H)` entropy bound for multisets (Section 17), both attained by quicksort (plain and three-way respectively). Only key-structure (radix/counting) sorts escape them.
- **Constant factors are theory, not just engineering** (Sections 13–15): median-of-three (`1.714 n ln n`), dual-pivot (`1.9 n ln n`), and Floyd-Rivest selection (`n + min(k,n-k)`) are precisely analyzable, and the analysis guided real library choices (JDK dual-pivot, Bentley-McIlroy ninther).
- **Worst case and average case are independent axes.** Improving the pivot-sampling constant (median-of-three) never removes the `O(n²)` worst case (Theorem 4.2); only randomization (input-independent expectation, Section 5) or an exact linear-time median (median-of-medians, Section 8) does.

Foundational references: Hoare (1961, 1962) for quicksort and quickselect; CLRS Chapter 7 (randomized analysis via indicator variables) and Chapter 9 (selection, median-of-medians); Blum-Floyd-Pratt-Rivest-Tarjan (1973) for `O(n)` worst-case selection; Sedgewick (1977, 1978) for the engineering and three-way analysis; Bentley-McIlroy (1993) "Engineering a Sort Function"; Dijkstra for the Dutch National Flag. Sibling topics: `01-merge-sort`, `03-heapsort`.
