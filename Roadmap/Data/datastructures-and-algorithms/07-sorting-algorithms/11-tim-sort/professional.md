# Tim Sort — Mathematical Foundations and Complexity Theory

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Correctness Proof of Stack Invariants](#correctness-proof-of-stack-invariants)
3. [Stack Depth Bound](#stack-depth-bound)
4. [The 2015 Invariant Bug — Formal Account](#the-2015-invariant-bug)
5. [Adaptive Complexity — The Mehlhorn / Munro Lower Bound](#adaptive-complexity-bound)
6. [Amortized Merge Cost](#amortized-merge-cost)
7. [Comparison with Optimal Adaptive Sorts](#comparison-with-optimal-adaptive-sorts)
8. [Decision-Tree Lower Bound](#decision-tree-lower-bound)
9. [Galloping — Probabilistic Analysis](#galloping--probabilistic-analysis)
10. [Summary](#summary)

---

## Formal Definition

```text
Definition: TimSort is a tuple (R, S, M, G) where:
  R : array -> [run_1, run_2, ..., run_k]    run-detection function
  S : run -> stack action {push, merge_top, merge_below}    stack policy
  M : (run_i, run_j) -> merged_run    stable merge with optional galloping
  G : (run_i, run_j) -> bool          gallop mode trigger

Input invariant:  Array A of length n with a total order <= over elements.
Output invariant: Sorted permutation pi(A) such that pi(A)[i] <= pi(A)[i+1] for all i,
                  and for equal keys, original input order is preserved (stability).
```

The whole algorithm is a state machine over the run stack `S` and the residual unscanned suffix of `A`. We prove correctness via three properties:

1. **Merge correctness** — `M` produces a sorted, stable concatenation of two sorted runs.
2. **Stack invariant preservation** — after every step, the stack satisfies the merge invariants.
3. **Termination** — every step either advances `lo` (the unscanned cursor) or pops a stack entry, both bounded.

---

## Correctness Proof of Stack Invariants

### The Invariants

Let `r_1, r_2, ..., r_k` be the stack entries with lengths `|r_1|, ..., |r_k|` indexed bottom-up (so `r_k` is the top). TimSort maintains:

```text
(I1)  For all i with i+2 <= k:   |r_i| > |r_{i+1}| + |r_{i+2}|
(I2)  For all i with i+1 <= k:   |r_i| > |r_{i+1}|
```

### Why These Invariants Are Useful

**Lemma 1 (Balanced Merges):** Under (I1) and (I2), any merge performed is between runs whose size ratio is bounded by `φ²` where `φ = (1 + √5)/2` is the golden ratio.

*Proof sketch:* The invariants force lengths to grow at least Fibonacci-fast bottom-up: `|r_i| > |r_{i+1}| + |r_{i+2}|` is exactly the Fibonacci recurrence inequality. By induction, `|r_i| > F_{k-i+2}` where `F_j` is the j-th Fibonacci number. Adjacent ratios approach `φ ≈ 1.618`. Merges thus combine runs of comparable size, capping merge cost.

**Lemma 2 (Stack Depth):** If the input has `n` elements and the invariants hold, then `k <= log_φ(n) + O(1) ≈ 1.44 log₂ n + O(1)`.

*Proof:* From `|r_1| > F_{k+1}` and `|r_1| <= n`, we get `F_{k+1} < n`. Since `F_j ≈ φ^j / √5`, we have `k <= log_φ(n · √5) = O(log n)`.

For `n = 2^63` (largest plausible array), `k <= 85`. CPython preallocates exactly 85; OpenJDK preallocates 49 (post-2015 fix, mathematically sufficient for Java's smaller `int`-indexed arrays).

### Invariant Restoration (Merge Selection)

```text
Algorithm CheckAndMerge:
  while stack has >= 2 entries:
    let X, Y, Z = third-from-top, second-from-top, top  (if exist)
    if |X| <= |Y| + |Z|  or  |Y| <= |Z|:
      if |X| < |Z|:
        merge X with Y  (combine the two below)
      else:
        merge Y with Z  (combine the top two)
    else if |Y| <= |Z|:    // only 2 entries case
      merge Y with Z
    else:
      break
```

**Claim:** After `CheckAndMerge` returns, both (I1) and (I2) hold.

*Proof:* Each loop iteration either:
- Merges Y with Z → stack shrinks by 1; restoration must continue.
- Merges X with Y → stack shrinks by 1; restoration must continue.
- Breaks → both invariants hold by the loop guard.

Termination is immediate (stack monotonically shrinks).

The critical step is the **choice of which pair to merge** when (I1) is violated: merge `Y` with whichever neighbor (`X` or `Z`) is **smaller**. This minimizes the resulting run length, giving the new stack the best chance of satisfying (I1) without further merges.

---

## Stack Depth Bound

### Formal Statement

**Theorem:** With invariants (I1) and (I2) maintained, the stack depth `k` satisfies `k <= log_φ(n) + 2`.

### Proof

By induction on `k`. Base: `k = 1`, depth 1 ≤ `log_φ(n) + 2` trivially.

Inductive: Suppose stack has `k+1` entries `r_1, ..., r_{k+1}` (bottom-up) with invariants holding. We claim `|r_1| > F_{k+1}` where `F` is the Fibonacci sequence (`F_1 = F_2 = 1`, `F_3 = 2`, ...).

From (I1) applied repeatedly:
- `|r_1| > |r_2| + |r_3|`
- `|r_2| > |r_3| + |r_4|`
- ...

By induction on stack depth: `|r_{k-1}| > |r_k| + |r_{k+1}| > 1 + 1 = 2 = F_3`. Walking up the stack, `|r_i| > F_{k+3-i}`. So `|r_1| > F_{k+2}`.

Since `|r_1| <= n` and `F_{k+2} < n` gives `k+2 < log_φ(n √5) = log_φ n + log_φ √5 ≈ log_φ n + 1`. Therefore `k < log_φ n - 1 + 2 = log_φ n + 1`. ∎

For `n = 2^31 ≈ 2.1 · 10^9` (Java `int` max), `log_φ n ≈ 45`. OpenJDK's stack of size 49 is sufficient.

---

## The 2015 Invariant Bug

### The Bug

In 2015, de Gouw, Rot, de Boer, Bubel, and Hähnle published *"OpenJDK's `java.utils.Collection.sort()` is broken: The good, the bad and the worst case"* (CAV 2015). They formally specified OpenJDK's TimSort using JML annotations, attempted verification with KeY, and found that:

> The merge-collapse routine only checks invariants among the **top three** stack entries. After a merge, an invariant violation can be **created at depth >= 4** without being detected.

### The Pathological Trigger

Consider stack lengths (bottom-up): `[120, 80, 25, 20, 30]`. The merge-collapse:

1. Inspect top three: `25, 20, 30`. Check (I1): `25 > 20 + 30 = 50`? No. Violated. Merge `20` with smaller of `25` and `30`. Both fail (I2), so merge `20` with `30`.
2. Stack: `[120, 80, 25, 50]`. Inspect top three: `80, 25, 50`. Check (I1): `80 > 25 + 50 = 75`? Yes ✓. Check (I2): `25 > 50`? No. Violated. Merge `25` with smaller of `80` and `50`. `50` smaller, merge `25` with `50`.
3. Stack: `[120, 80, 75]`. Inspect: `120, 80, 75`. Check (I1): `120 > 80 + 75 = 155`? No. Violated. Merge `80` with smaller of `120` and `75`. Merge with `75`.
4. Stack: `[120, 155]`. Done?

But mathematically, a careful adversarial input (de Gouw et al. construct one) can produce a situation where, after step 2, the stack invariants are violated **at depth >= 4** but the algorithm only re-checks top three. The error compounds and the stack can grow beyond OpenJDK's preallocated `MAX_MERGE_PENDING = 40`.

### The Construction

The authors give an explicit sequence of run lengths that, when pushed in order through OpenJDK's merge-collapse, breaks the invariant deep in the stack:

```text
run lengths: 1073741824, 1073741824, ..., specific Fibonacci-like sequence
```

The construction uses ~10⁹-element runs in a specific pattern. In practice, no programmer writes such input by accident — the bug is provoked only by adversarial inputs. But it's **a real bug** — the algorithm violates its specification.

### The Fixes

**OpenJDK 9 (2017):**
- Increased `MAX_MERGE_PENDING` from 40 to 49 (sufficient bound, derived from a more careful Fibonacci analysis).
- Re-examined merge-collapse to ensure invariants hold beyond top-three after each step.

**CPython 3.6.3 (2017):**
- Tim Peters added an extra invariant check at depth 4. The merge-collapse now ensures `|r_{k-3}| > |r_{k-2}| + |r_{k-1}|` (one level deeper).

### What the Bug Teaches

1. **Empirical testing has limits.** OpenJDK's TimSort had been in production since 2009, sorting billions of arrays, before the bug was found.
2. **Formal verification finds real bugs.** This is a landmark case for the KeY theorem prover and the formal methods community.
3. **Sorting algorithms are subtle.** Even Tim Peters' own description of the invariants was insufficient for formal proof.

The paper is required reading for anyone working on production sorting.

---

## Adaptive Complexity Bound

### The Adaptive Bound

**Theorem (Auger, Nicaud, Pivoteau, 2015):** TimSort on an input with `R` natural runs takes `Θ(n + n log R)` comparisons in the worst case.

### Proof Sketch

**Upper bound:** Detection of runs costs `O(n)` (one linear scan). The merge phase reduces `R` runs to 1 via a balanced merge tree of depth `O(log R)`. At each level of the tree, total merge cost is `O(n)` (every element touched once). Hence total cost is `O(n log R)`. Run detection plus merges: `O(n + n log R)`. ∎

**Lower bound:** For arbitrary inputs with `R` runs, no comparison sort can do better than `n + n log R` comparisons. This is shown via an information-theoretic argument: there are at least `n! / (m_1! · m_2! · ... · m_R!)` distinct sorted permutations consistent with the run structure, and any decision tree must have at least that many leaves. Stirling's approximation gives the bound.

So **TimSort matches the adaptive lower bound** up to constants.

### Mehlhorn's Measure

Mehlhorn (1979) introduced the **measure of presortedness** `Rem(A)` — the minimum number of elements that must be removed to make `A` sorted. A sort is **`Rem`-optimal** if its runtime is `O(n + n log Rem(A))`.

TimSort is `Rem`-optimal up to a constant: a near-sorted input (e.g., 1% perturbed) has `Rem(A) = O(n/100)` and TimSort runs in `O(n + n log(n/100)) ≈ O(n log n / 100 + n)` — much faster than a non-adaptive O(n log n) sort.

### Other Adaptive Sorts

Several sorts are also `O(n + n log R)`-optimal:

| Algorithm | Notes |
|-----------|-------|
| **Natural Merge Sort** | Plain merge sort on detected runs; lacks `minrun` padding |
| **Patience Sort** | Build piles greedily, merge with heap |
| **PowerSort** (Munro & Wild, 2018) | Provably optimal merge tree without stack invariants |
| **Strand Sort** | Repeatedly extract sorted subsequences |

PowerSort, introduced in 2018, gives an even cleaner merge policy: assign each run a "node power" based on its merge depth, and merge whenever powers indicate. It matches TimSort's adaptive bound with simpler invariants.

---

## Amortized Merge Cost

### Aggregate Analysis

Consider the total cost of all merges. Each merge of runs of sizes `a` and `b` costs `O(a + b)`. The invariants force runs to be "balanced" (size ratio bounded by `φ²`).

**Theorem:** The total merge cost across all merges is `O(n log R)` where `R` is the number of runs.

*Proof:* The merge tree has at most `R` leaves and depth `O(log R)`. Total elements at each level is `n`. So total merge work is `n · log R = O(n log R)`. ∎

### Potential Method

Define the potential `Φ(stack) = Σ_i |r_i| · (k - i + 1)` — each run's length times its "depth weight."

After each push, `Φ` increases by `|r_{new}| · 1` (small). After each merge, two runs of sizes `a, b` at positions `i, i+1` are replaced by one of size `a + b` at position `i`. The change in potential:

```text
ΔΦ = (a + b)(k - i) - a(k - i) - b(k - i - 1) = -b
```

Negative — merging decreases the potential. The actual cost of the merge is `O(a + b)`. The amortized cost is `a + b - b = a`. Summed over all merges:

```text
Sum of amortized costs = Sum of (smaller of merged pair)
```

Under the invariants, the "smaller of merged pair" is at most `Fibonacci`-bounded — summed over all merges gives `O(n log R)`.

---

## Comparison with Optimal Adaptive Sorts

| Sort | Adaptive bound | Stable | Practical | Complexity to implement |
|------|----------------|--------|-----------|------------------------|
| **TimSort** | O(n + n log R) | Yes | **Yes** — production default | High (~1000 LOC) |
| **PowerSort** | O(n + n log R) | Yes | Newer, less battle-tested | Medium |
| **Natural Merge Sort** | O(n + n log R) | Yes | Educational | Low |
| **Patience Sort** | O(n + n log R) | No | Niche | Medium |
| **Smooth Sort** | O(n) best, O(n log n) worst | No | Rarely used | High |
| **Splay Sort** | O(n log n) | No | Theoretical | Medium |

All listed sorts achieve the optimal adaptive bound. TimSort dominates in practice because:

1. **Constants are small** — Tim Peters tuned every threshold by benchmarking.
2. **Galloping** — exploits not just run count but run length disparity, reducing comparisons further.
3. **`minrun` padding** — turns micro-runs into balanced merges instead of leaving them tiny.

PowerSort is a credible successor; its merge policy is simpler to prove correct and has the same complexity. Some production systems are evaluating a migration.

---

## Decision-Tree Lower Bound

```text
Theorem: Any comparison-based sort requires Ω(n log n) comparisons in the worst case.

Proof:   Decision tree T for sorting n elements has n! distinct leaves
         (one per permutation). The height of T is at least ⌈log₂(n!)⌉.
         By Stirling: log₂(n!) = n log₂ n - n log₂ e + O(log n) = Θ(n log n).
         Worst-case # comparisons ≥ height of T ≥ Ω(n log n). QED
```

TimSort matches this bound asymptotically on random inputs. On structured inputs with `R` runs, the adaptive lower bound is `Ω(n + n log R)` (also via a decision-tree argument restricted to permutations consistent with the run structure), and TimSort matches that too.

---

## Galloping — Probabilistic Analysis

When merging runs A and B of sizes m and n, define `p_A` = probability that the next merge step takes from A. For random data, `p_A ≈ 0.5` regardless of which side; galloping triggers rarely, so overhead is `O(1)` per merge step.

For "one side dominates" data (e.g., merging long list with short append), `p_A` near 1 or 0. Probability of `min_gallop = 7` consecutive wins is `p^7` (≈ 0.99² ≈ 0.93 if `p = 0.99`). Once galloping triggers, exponential search finds the next loser in O(log k) where k is the gap. Total cost per gallop bulk: `O(log k)` instead of `O(k)`.

**Expected cost analysis:** For a merge where the dominating run contributes `D` elements and the dominated run contributes `d` (D >> d), naive cost is `O(D + d)`. With galloping: `O((D / k_avg) · log k_avg + d)` where `k_avg ≈ D/d`. Asymptotically: `O(d · log(D/d) + d)`. For `D = 10^6, d = 10`: naive ≈ 10^6, gallop ≈ 200. **5000× speedup on this shape.**

---

## Summary

At the professional level, TimSort is understood as a **provably correct, adaptively optimal, stable comparison sort** with subtle invariants whose deficiency required formal verification to expose. Key results:

1. **Stack invariants (I1) `A > B + C` and (I2) `B > C`** bound stack depth to `O(log_φ n)` and ensure balanced merges.
2. **The 2015 OpenJDK bug** showed that empirical testing alone cannot guarantee correctness — formal verification (KeY) found a real defect in production code 13 years old.
3. **Adaptive bound `Θ(n + n log R)`** matches the information-theoretic lower bound for comparison sorts on inputs with `R` natural runs (Mehlhorn's measure).
4. **PowerSort** offers a simpler invariant policy with the same complexity — a potential future replacement.
5. **Amortized merge cost** analysis via the potential method confirms `O(n log R)` total merge work.

The professional perspective: TimSort is the **best-known practical adaptive sort**, but it is not the **simplest** — and not the **only** sort with optimal adaptive complexity. Its dominance is engineering excellence, not theoretical uniqueness.
