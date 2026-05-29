# Ternary Search — Professional Level

> **Audience:** Algorithm designers and researchers. Prerequisites: discrete math (logarithms, ratios), basic calculus (unimodality, convexity), comfort with asymptotic analysis.

This document gives the **formal mathematical treatment** of ternary search and its close relatives: a precise definition, a correctness proof for the unimodal-function variant, the exact recurrence `T(n) = T(2n/3) + O(1)` yielding `Θ(log_{3/2} n)` iterations, the comparison with the **Fibonacci search lower bound**, the proof that **golden-section search is information-theoretically optimal** among derivative-free unimodal optimization methods, and the precise sense in which **binary search dominates ternary search on monotonic data**.

---

## Table of Contents

1. [Formal Definition](#definition)
2. [Correctness Proof via Loop Invariants](#correctness)
3. [Exact Iteration Count and the Recurrence](#recurrence)
4. [Tight Lower Bound — Fibonacci-Search Optimality](#lower-bound)
5. [Why Binary Beats Ternary for Monotonic Search](#binary-beats)
6. [Cache Complexity and Practical Constants](#cache)

---

<a name="definition"></a>
## 1. Formal Definition

### Problem

Let `f : [a, b] → ℝ` be a **strictly unimodal** function with a maximum at `x* ∈ [a, b]`: there exists `x*` such that `f` is strictly increasing on `[a, x*]` and strictly decreasing on `[x*, b]`. Given a precision `ε > 0`, the **unimodal optimization problem** is to compute `x̂` such that `|x̂ - x*| ≤ ε`.

### Ternary search as a procedure

```
function TernarySearch(f, a, b, ε):
    while b - a > ε:
        m1 ← a + (b - a) / 3
        m2 ← b - (b - a) / 3
        if f(m1) < f(m2): a ← m1
        else:             b ← m2
    return (a + b) / 2
```

(For the strictly-increasing/decreasing-with-equal-tie case at `f(m1) = f(m2)`, the algorithm conventionally takes the `f(m1) ≤ f(m2)` branch; on truly unimodal `f` equality occurs only on plateaus, which we exclude by the strict-unimodality assumption.)

For the integer-domain analog `f : {0, …, n-1} → ℝ`, replace `> ε` with `> 2` and add a final linear scan of the surviving ≤ 3 points.

### Variants

- **Find minimum.** Flip the comparison: `f(m1) > f(m2)` ⇒ `a ← m1`.
- **Golden-section search.** Place probes at `m1 = b - ρ(b - a)`, `m2 = a + ρ(b - a)` with `ρ = 1/φ = (√5 - 1)/2 ≈ 0.618`. Reuses one probe per iteration after the first.
- **Fibonacci search.** Discrete-budget analog using Fibonacci numbers as probe positions. Optimal for fixed `n` evaluations.

---

<a name="correctness"></a>
## 2. Correctness Proof via Loop Invariants

We prove correctness of the real-valued maximum variant under strict unimodality.

### The invariant

> **(I)** At the top of every iteration, `a ≤ x* ≤ b`.

That is, the unique maximizer `x*` is always within the current bracket.

### Proof of (I)

**Initialization.** By assumption `x* ∈ [a₀, b₀]`. (I) holds.

**Maintenance.** Assume (I) holds with `b - a > ε`. Compute `m1 = a + (b - a)/3` and `m2 = b - (b - a)/3`, so `a < m1 < m2 < b`. There are three cases for the position of `x*`:

- **Case A:** `x* ∈ [a, m1]`. Then on `[m1, m2]`, `f` is strictly decreasing (since this interval is entirely after the peak), so `f(m1) > f(m2)`. The algorithm sets `b ← m2`. New bracket `[a, m2]` still contains `x*` since `x* ≤ m1 < m2`. (I) holds.
- **Case B:** `x* ∈ [m2, b]`. By symmetry, `f` is strictly increasing on `[m1, m2]` (since this is before the peak), so `f(m1) < f(m2)`. The algorithm sets `a ← m1`. New bracket `[m1, b]` still contains `x*` since `x* ≥ m2 > m1`. (I) holds.
- **Case C:** `x* ∈ (m1, m2)`. Then on `[m1, x*]`, `f` is strictly increasing; on `[x*, m2]`, strictly decreasing. The comparison `f(m1) vs f(m2)` could go either way (depending on which side of the peak is "more loaded"). In either case the new bracket includes `x*`:
  - If `f(m1) < f(m2)`: `a ← m1`. New bracket `[m1, b] ⊇ (m1, m2) ∋ x*`. ✓
  - If `f(m1) ≥ f(m2)`: `b ← m2`. New bracket `[a, m2] ⊇ (m1, m2) ∋ x*`. ✓

In all cases (I) is maintained.

**Termination.** Each iteration replaces `b - a` with `b - a - (b - a)/3 = 2(b - a)/3`. Starting from `b₀ - a₀`, after `k` iterations the bracket width is `(2/3)^k (b₀ - a₀)`. The loop exits when this drops below `ε`, which happens at:

```
k ≥ ⌈log_{3/2}((b₀ - a₀) / ε)⌉
```

iterations.

**Postcondition.** When the loop exits, `b - a ≤ ε` and `x* ∈ [a, b]`. Therefore `|x̂ - x*| = |(a + b)/2 - x*| ≤ (b - a)/2 ≤ ε / 2`. ∎

### A subtlety: the strict-unimodality assumption

If `f` has a plateau at the top — `f` is constant on some `[p, q] ⊆ [a, b]` with `q - p > 0` — then the case analysis above breaks because Case A becomes "`f(m1) ≥ f(m2)` with equality possible" and similarly for B. The algorithm still terminates and returns a point in the plateau, but the guarantee `|x̂ - x*| ≤ ε` only holds in the weaker sense `x̂ is in the maximizing set`. This is usually fine in practice (any maximizer is a valid answer), but be aware.

---

<a name="recurrence"></a>
## 3. Exact Iteration Count and the Recurrence

### Claim

Ternary search on `f : [a₀, b₀] → ℝ` with precision `ε` performs **exactly** `⌈log_{3/2}((b₀ - a₀) / ε)⌉` iterations in the worst case, each costing two evaluations of `f`.

### Proof

Let `R_k = b_k - a_k` be the bracket width after `k` iterations. The recurrence is:

```
R_0 = b_0 - a_0
R_{k+1} = R_k - R_k / 3 = (2/3) R_k
```

Therefore `R_k = (2/3)^k R_0`. The loop exits when `R_k ≤ ε`:

```
(2/3)^k R_0 ≤ ε
k ≥ log((R_0 / ε)) / log(3/2)
k ≥ log_{3/2}(R_0 / ε)
```

The smallest integer satisfying this is `⌈log_{3/2}(R_0 / ε)⌉`. ∎

### Concrete numbers

| `R_0 / ε` | `⌈log_{3/2}(R_0 / ε)⌉` | × 2 evals |
|---|---|---|
| 10 | 6 | 12 |
| 100 | 12 | 24 |
| 10³ | 18 | 36 |
| 10⁶ | 35 | 70 |
| 10⁹ | 52 | 104 |
| 10¹⁵ | 86 | 172 |

For ε at machine epsilon (`~10⁻¹⁵` relative) on a normal-magnitude range, ~85 iterations suffice. The conventional "200 iterations" in production code is **double-overkill safety**.

### Comparison with golden-section

| Method | Shrink/iter | Iters to `ε` | Evals/iter | Total evals |
|---|---|---|---|---|
| Ternary | `2/3` | `log_{3/2}(R/ε)` ≈ 1.71 log₂ | 2 | ~3.42 log₂(R/ε) |
| Golden-section | `1/φ ≈ 0.618` | `log_φ(R/ε)` ≈ 1.44 log₂ | 1 (amortized) | ~1.44 log₂(R/ε) |

Golden-section's iteration count is slightly worse (1.71 → 1.44 in different direction since `1/φ ≈ 0.618 > 2/3 ≈ 0.667` is *smaller* — wait, `1/φ ≈ 0.618 < 2/3 ≈ 0.667`, so golden-section shrinks **faster** per iter). Both effects help golden-section: fewer iterations *and* fewer evals per iteration. Golden-section's total is about 42% of ternary's.

### The integer case

For `f : {0, …, n-1} → ℝ`, the bracket halves (approximately) until `hi - lo ≤ 2`. The recurrence is `T(n) = T(⌈2n/3⌉) + O(1)`, solving to `T(n) = O(log_{3/2} n)`. Exactly `⌈log_{3/2}(n - 2)⌉ + 1` iterations in the worst case, plus a final O(1) linear scan.

---

<a name="lower-bound"></a>
## 4. Tight Lower Bound — Fibonacci-Search Optimality

### Theorem (Kiefer, 1953)

Among **derivative-free** algorithms that locate the maximum of a strictly unimodal function on a bounded interval `[a, b]` using only function evaluations, the algorithm that **achieves the minimum number of evaluations for any given precision** is **Fibonacci search**, with golden-section search as the limit as the budget → ∞.

### Proof sketch

The argument is information-theoretic. Each function evaluation at a point `m ∈ [a, b]` partitions the possible locations of `x*` into at most three intervals (left of `m`, equal to `m`, right of `m`), but in the unimodal-with-strict-monotonicity case, only the comparison of two evaluations is informative.

For `k` evaluations used in total, the optimal bracketing strategy reduces the bracket width by a factor that satisfies the Fibonacci recurrence:

```
F_k / F_{k+1}
```

where `F_k` is the `k`-th Fibonacci number. As `k → ∞`, `F_k / F_{k+1} → 1/φ`, the golden ratio's reciprocal. This is the **best possible shrink** for any derivative-free unimodal optimizer.

Naive ternary search achieves shrink `2/3` per **iteration** but uses **2 evaluations per iteration**, so its **per-evaluation shrink** is `(2/3)^{1/2} ≈ 0.816` — worse than golden-section's `1/φ ≈ 0.618` per evaluation. The lower bound says no algorithm beats golden-section's `1/φ` per evaluation asymptotically.

### Implications

- **Naive ternary is information-theoretically suboptimal.** Golden-section dominates by a constant factor.
- **Fibonacci search is optimal for fixed evaluation budget `k`.** When you need exactly `k` evaluations and want the smallest possible final bracket, use Fibonacci search.
- **Golden-section is optimal in the limit.** For unbounded precision, golden-section's asymptotic rate is unbeatable.
- **To go faster, you must change the model** — use derivatives (bisect `f'`, Newton's method) or use structure beyond unimodality (convexity gives access to interior-point methods, smoothness allows quadratic fits, etc.).

### The randomized lower bound

A randomized derivative-free unimodal optimizer also needs `Ω(log(R/ε))` expected evaluations. The decision-tree argument generalizes via Yao's principle (treat the randomized algorithm as a distribution over deterministic ones).

---

<a name="binary-beats"></a>
## 5. Why Binary Beats Ternary for Monotonic Search

A common student question: "If ternary shrinks to `2/3` per iter vs binary's `1/2`, isn't ternary doing more work per shrink? Doesn't that just mean ternary is bigger steps?"

The answer requires counting **comparisons (or function evaluations) per unit shrink** carefully.

### Setup

Search a sorted array of `n` elements for a target. Both algorithms locate the target by comparison.

**Binary search.** 1 comparison per iteration. Shrinks search window from `s` to `⌊s/2⌋`. Worst-case iteration count: `⌈log₂(n + 1)⌉`. **Comparisons total: `⌈log₂(n + 1)⌉`.**

**Ternary search on sorted array.** 2 comparisons per iteration (`target vs arr[m1]` and `target vs arr[m2]`). Shrinks search window from `s` to `⌈s/3⌉` (each of the three pieces is at most `⌈s/3⌉`). Worst-case iteration count: `⌈log₃(n)⌉`. **Comparisons total: `2 × ⌈log₃(n)⌉`.**

### The comparison

```
binary_comps   = log₂(n)
ternary_comps  = 2 × log₃(n) = 2 × log(n) / log(3) ≈ 1.26 × log(n) / log(2) = 1.26 × log₂(n)
```

Ternary uses **~26% more comparisons** than binary for sorted-array search. Binary wins.

### The information-theoretic angle

Each comparison `target vs arr[mid]` returns one of three outcomes (`<`, `=`, `>`). Treated as a 3-way comparison, the **information-theoretic minimum** is `⌈log₃(n + 1)⌉` comparisons. Binary search ignores the `=` case shortcut and uses only `<` vs `≥` (a 2-way split), achieving `⌈log₂(n + 1)⌉`.

But in practice, the `arr[mid] == target` branch is rarely taken (one out of `n` queries hits), so the **expected** comparison count of binary search is essentially `log₂(n)`, and the `log₃(n+1)` bound is met only by a true 3-way binary search that explicitly checks equality first (which most implementations don't).

For ternary search, two 2-way comparisons gives `2 × log₂(3) / 2 = log₂(3)` bits per probe — actually less per comparison than binary's 1 bit. Each binary comparison is 1 bit of useful information; each ternary comparison is `log₂(3)/2 ≈ 0.79` bits. **Binary is information-theoretically more efficient.**

### When does the analysis change?

If your **comparison primitive is 3-way** (Java's `compareTo` returns `-1, 0, +1`, Python's `(x > y) - (x < y)`, C's `strcmp`), then ternary search **does** approach the `log₃(n)` bound — but binary search using the 3-way primitive also approaches `log₃(n)` (by stopping early on equality). They're roughly tied.

The conclusion stands: **for ordered search, use binary search.** Ternary search is for unimodal data, where binary doesn't apply.

---

<a name="cache"></a>
## 6. Cache Complexity and Practical Constants

### Cache misses

Ternary search has the same asymptotic cache-miss pattern as binary search: each of the early iterations touches a new cache line (when the window is bigger than `M/B`), and later iterations hit cache. The first `~log(nB/M)` iterations are misses.

In practice, ternary's two probes per iteration mean it touches **2×** as many cache lines per iteration. For cache-bound workloads, ternary is worse than binary by a constant factor close to 2.

### Practical timing comparison

For 10⁶-element sorted int32 array (4 MB, fits in typical L2):

| Algorithm | Comparisons | Cache misses | Time |
|---|---|---|---|
| Binary | ~20 | ~5 | ~30 ns |
| Ternary (sorted) | ~26 | ~10 | ~50 ns |
| Ternary (unimodal find peak) | ~26 | ~10 | ~50 ns |
| Golden-section | ~14 | ~5 | ~25 ns |

(Numbers approximate; benchmark for your hardware.)

For unimodal optimization tasks the comparison is between **ternary and golden-section**, where golden-section wins by ~2×. For sorted-array search, binary trivially wins.

### High-precision real-valued setting

When the comparison count is small (`< 100`) and each function evaluation is expensive (microseconds to milliseconds), **the evaluation cost dominates**. The shrink-per-evaluation factor (`(2/3)^{1/2}` for ternary, `1/φ` for golden) determines the runtime, not the cache behavior. Golden-section dominates.

For nano-cost arithmetic functions, cache and branch-prediction effects matter, and benchmarking is mandatory.

---

## Summary of Bounds

| Quantity | Value |
|---|---|
| Iterations to precision `ε` (range `R`) | `⌈log_{3/2}(R/ε)⌉` |
| Function evaluations (ternary) | `2 × ⌈log_{3/2}(R/ε)⌉` ≈ `3.42 log₂(R/ε)` |
| Function evaluations (golden) | `~1.44 log₂(R/ε) + 1` |
| Function evaluations (Fibonacci, fixed budget `k`) | `k` (optimal for the precision achievable in `k`) |
| Lower bound on evals (any derivative-free) | `Ω(log_φ(R/ε))` = `Ω(1.44 log₂(R/ε))` |
| Comparisons (ternary sorted-array) | `2 × ⌈log₃(n + 1)⌉` ≈ `1.26 log₂ n` |
| Comparisons (binary sorted-array) | `⌈log₂(n + 1)⌉` |
| Cache misses (large `n`) | `Θ(log(n))` — same asymptotic as binary, ~2× constant |
| Iterative space | `O(1)` |
| Recursive space | `O(log n)` |

These bounds are **tight** in the derivative-free comparison model. To go faster, abandon the model — use derivatives (Newton, bisect `f'`), structure (interpolation when `f` is smooth, quadratic-fit-and-extrapolate), or batching (parallel evaluations).

---

## Further Reading

- **Kiefer**, "Sequential minimax search for a maximum" (J. ACM, 1953). The lower bound and the proof of Fibonacci-search optimality.
- **Avriel & Wilde**, "Optimality proof for the symmetric Fibonacci search technique" (Fibonacci Quarterly, 1966). The cleanest modern proof.
- **Brent**, *Algorithms for Minimization Without Derivatives* (1973). The reference text. Chapter 5 covers golden-section and the optimality results.
- **Nocedal & Wright**, *Numerical Optimization*, 2nd ed., Chapter 3, §3.5 — line-search line-by-line with rigor.
- **Polak**, *Optimization: Algorithms and Consistent Approximations* (1997). The convergence-theory perspective.
- **CP-Algorithms** entry on Ternary Search — concise modern treatment with code.
- **Knuth TAOCP v3**, §6.2.1 — discrete search lower bounds including the 3-way comparison angle.
