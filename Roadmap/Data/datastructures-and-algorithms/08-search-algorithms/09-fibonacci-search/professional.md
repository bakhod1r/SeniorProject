# Fibonacci Search — Professional Level

> **Audience:** Algorithm designers, applied mathematicians, and engineers who want the precise mathematical underpinning. Prerequisites: comfort with logarithms in irrational bases, Fibonacci identities, basic real analysis.

This document gives the formal treatment: a precise definition of the algorithm, a correctness proof via Fibonacci invariants, the **exact** worst-case comparison count `⌈log_φ((n+1)√5)⌉ − 1`, a derivation showing that the **golden ratio 1/φ² ≈ 0.382 is the unique probe fraction that allows reuse of evaluations** in continuous unimodal optimization, the connection to Zeckendorf representations of integers, and the information-theoretic lower bound on derivative-free unimodal optimization that golden-section search achieves up to a constant.

---

## Table of Contents

1. [Formal Definition](#definition)
2. [Correctness Proof via Fibonacci Invariants](#correctness)
3. [Exact Comparison Count `⌈log_φ((n+1)√5)⌉ − 1`](#count)
4. [Why 1/φ² is the Optimal Probe Ratio](#why-phi)
5. [Connection to Zeckendorf Representation](#zeckendorf)
6. [Lower Bound for Derivative-Free Unimodal Optimization](#lower-bound)

---

<a name="definition"></a>
## 1. Formal Definition

### Problem

Let `A = [a_0, a_1, …, a_{n−1}]` be a sorted sequence of `n` elements from a totally ordered set `(S, ≤)`. Given a query `t ∈ S`, the **Fibonacci search problem** is to return any index `i` with `a_i = t`, or `⊥` if no such index exists.

### The procedure

Let `(F_k)_{k ≥ 0} = 0, 1, 1, 2, 3, 5, 8, …` be the Fibonacci sequence, satisfying `F_0 = 0`, `F_1 = 1`, `F_k = F_{k-1} + F_{k-2}`. Define `m := min{k ≥ 0 : F_k ≥ n}`. Maintain the state `(F_m, F_{m-1}, F_{m-2}, \text{offset})` initialized as `(F_m, F_{m-1}, F_{m-2}, -1)`. Then:

```
while F_m > 1:
    i := min(offset + F_{m-2}, n − 1)
    if a_i = t:        return i
    if a_i < t:
        (F_m, F_{m-1}, F_{m-2}) ← (F_{m-1}, F_{m-2}, F_{m-1} − F_{m-2})    # shift forward
        offset ← i
    else:
        (F_m, F_{m-1}, F_{m-2}) ← (F_{m-2}, F_{m-1} − F_{m-2}, F_{m-2} − (F_{m-1} − F_{m-2}))    # shrink left
# final 1-element check
if F_{m-1} = 1 ∧ offset + 1 < n ∧ a_{offset+1} = t:
    return offset + 1
return ⊥
```

### Key arithmetic property

Every update to `(F_m, F_{m-1}, F_{m-2})` uses **only subtraction** between current state values. There is no division, no multiplication, no need for a precomputed table beyond the initial sequence construction (itself O(log n) additions).

### Loop invariant (informal)

> At the top of every iteration, `(F_m, F_{m-1}, F_{m-2})` is a **consecutive triple** of Fibonacci numbers, and the search window is `(offset, offset + F_m] ∩ [0, n-1]`.

We formalize this in §2.

---

<a name="correctness"></a>
## 2. Correctness Proof via Fibonacci Invariants

### Invariants

Let the algorithm be in state `(F_m, F_{m-1}, F_{m-2}, \text{offset})` at the top of an iteration. Define the **active window**:

```
W := {j ∈ [0, n) : j > offset ∧ j ≤ offset + F_m}
```

We claim three invariants:

> **(I1)** `F_{m-2} + F_{m-1} = F_m`. The triple is consecutive.
>
> **(I2)** If `t ∈ A`, then `arg_j (a_j = t) ∈ W`.
>
> **(I3)** `F_m` strictly decreases between iterations.

### Proof

**Initialization.** Before the first iteration, `(F_m, F_{m-1}, F_{m-2})` is set such that `F_m ≥ n > F_{m-1}`. The triple is consecutive Fibonacci. The window `W = {0, 1, …, F_m} ∩ [0, n)`, which contains every index. So (I1) and (I2) hold. (I3) is vacuously true.

**Maintenance.** Assume (I1)–(I3) hold. Let `i = min(offset + F_{m-2}, n − 1)`.

- **Case `a_i = t`:** Return `i`. Algorithm terminates correctly.

- **Case `a_i < t`:** No index in `[offset+1, i]` is the answer. The new state is `(F_{m-1}, F_{m-2}, F_{m-1} − F_{m-2})` with `offset' = i`. Then:
  - (I1) `F_{m-2} + (F_{m-1} − F_{m-2}) = F_{m-1}` ✓
  - (I2) Old `W` was `(offset, offset + F_m]`. The new window is `(i, i + F_{m-1}] = (offset + F_{m-2}, offset + F_{m-2} + F_{m-1}] = (offset + F_{m-2}, offset + F_m]`. Since `a_i < t`, the answer is in `(i, offset + F_m]` — exactly the new window.
  - (I3) New `F_m' = F_{m-1} < F_m`. ✓

- **Case `a_i > t`:** No index in `[i, offset + F_m]` is the answer. The new state is `(F_{m-2}, F_{m-1} − F_{m-2}, F_{m-2} − (F_{m-1} − F_{m-2}))` and offset unchanged.
  - (I1) Let `A = F_{m-2}`, `B = F_{m-1} − F_{m-2}`. Need `B + C = A`, with `C = A − B = F_{m-2} − (F_{m-1} − F_{m-2}) = 2F_{m-2} − F_{m-1}`. Then `B + C = (F_{m-1} − F_{m-2}) + (2F_{m-2} − F_{m-1}) = F_{m-2} = A`. ✓
  - (I2) New window is `(offset, offset + F_{m-2}] = (offset, i − 1]`. Since `a_i > t`, the answer is in `(offset, i)`, equivalently `(offset, i − 1]` for integer indices. ✓
  - (I3) New `F_m' = F_{m-2} < F_m`. ✓

**Termination.** By (I3), `F_m` strictly decreases each iteration. Since `F_m` is a positive integer, the loop runs for at most `m + 1` iterations, where `m` is the initial Fibonacci index. So the algorithm halts.

**Postcondition.** Upon loop exit (`F_m ≤ 1`), the window `W` has at most one element, namely `offset + 1` (if `offset + 1 < n`). The final explicit check returns it if `a_{offset+1} = t`. Otherwise the algorithm returns `⊥`, which is correct because by (I2) the answer (if it existed) was in `W` at every step, and `W` is now empty or contains exactly the rejected element. ∎

### A subtle point: clamping `i`

When `offset + F_{m-2} ≥ n`, we clamp `i = n − 1`. This does not violate any invariant because the array elements at positions `≥ n` are "virtually `+∞`" — they are treated as larger than any target. The algorithm correctly takes the "go-left" branch when the probe is at a non-existent index, reducing `F_m` and effectively skipping the over-extension. Knuth (TAOCP v3 §6.2.1, exercise 30) notes this as an instance of the more general technique of "phantom elements" — virtual entries that simplify boundary handling without changing asymptotic complexity.

---

<a name="count"></a>
## 3. Exact Comparison Count `⌈log_φ((n+1)√5)⌉ − 1`

### Claim

Fibonacci search on a sorted array of `n` elements performs at most

```
C(n) = m − 1
```

comparisons in the worst case, where `m` is the smallest integer with `F_m ≥ n + 1`. Using Binet's formula:

```
F_m = (φ^m − ψ^m) / √5,   φ = (1+√5)/2,   ψ = (1−√5)/2
```

we get `F_m ≥ n + 1 ⇔ φ^m ≥ (n+1)√5 + ψ^m`. Since `|ψ| < 1` and `m ≥ 1`, `|ψ^m| < 1`, so asymptotically:

```
m = ⌈log_φ((n+1)√5)⌉
```

### Proof of upper bound

Each iteration either terminates (case `a_i = t`) or reduces `F_m` to either `F_{m-1}` or `F_{m-2}`. In the worst case, every iteration goes to `F_{m-1}` (which is larger of the two), and `F_m` decreases by one index per iteration. Starting at `m`, the loop runs while `F_m > 1`, i.e., while `m ≥ 2`. So at most `m − 1` iterations.

Each iteration does **one comparison** of `a_i` to `t`. Hence at most `m − 1 = ⌈log_φ((n+1)√5)⌉ − 1` comparisons.

### Concrete numbers

| `n` | `m` such that `F_m ≥ n + 1` | Comparisons `m − 1` | Binary `⌈log₂(n+1)⌉` | Ratio |
|---|---|---|---|---|
| 1 | 2 | 1 | 1 | 1.00 |
| 10 | 6 | 5 | 4 | 1.25 |
| 100 | 11 | 10 | 7 | 1.43 |
| 1,000 | 16 | 15 | 10 | 1.50 |
| 10,000 | 20 | 19 | 14 | 1.36 |
| 100,000 | 25 | 24 | 17 | 1.41 |
| 1,000,000 | 30 | 29 | 20 | 1.45 |
| 10,000,000 | 34 | 33 | 24 | 1.38 |
| 1,000,000,000 | 44 | 43 | 30 | 1.43 |

Asymptotic ratio:

```
lim (m_F / m_B) = log₂(2) / log_φ(φ) × log_φ(?) / log₂(?)
              = log₂ / log_φ = log(2) / log(φ) ≈ 0.693 / 0.481 ≈ 1.4404
```

So Fibonacci search uses ~44% more comparisons asymptotically. The variation in the ratio above (1.36 to 1.50) reflects the **ceiling discreteness** in both formulas.

### Average-case comparison count

Knuth (TAOCP v3 §6.2.1, Theorem) gives the average-case count under uniform random `t ∈ A`:

```
C_avg(n) ≈ (φ^m − 1) / (n φ^{m−2})    asymptotically ≈ log_φ n − 0.55
```

Roughly 1 comparison less than worst-case, similar to binary search's average case being 1 less than worst.

### Proof of optimality among division-free algorithms

This is more subtle. Theorem (informal): **any** comparison-based search algorithm that uses only addition and subtraction (and bit-shifts of arguments by constants) on indices must perform at least `(1 − ε) log_φ n` comparisons in the worst case, for any `ε > 0`. (Sketched in Knuth, exercise 6.2.1.34.)

The proof uses an adversary argument: the adversary places the target so that each probe eliminates only the smaller chunk. With a 1:φ ratio probe placement (the only ratio achievable by pure addition/subtraction in a single linear pass), this matches the upper bound up to constants.

---

<a name="why-phi"></a>
## 4. Why 1/φ² is the Optimal Probe Ratio

This is the continuous-domain golden-section analysis. Setup: we have a unimodal function `f : [0, 1] → R` and want to find its minimizer using as few function evaluations as possible. We will probe at two points `r` and `1 − r`, then recursively work on one of the two resulting subintervals.

### The reuse property

Suppose we eliminate the right side `(1 − r, 1]`. The new interval is `[0, 1 − r]`. We want the **old probe at `r`** to **coincide** with one of the two probes we would naturally place in the new interval. Specifically, the old probe `r` should be at the right golden-section point of the new interval, so we only evaluate one new point next iteration.

The right golden-section point of `[0, 1 − r]` is at `(1 − r) × r` (the same fraction `r` of its length from the right edge). Equivalently from the left, at `(1 − r) − (1 − r) r = (1 − r)(1 − r) = (1 − r)^2`.

For reuse: `r = (1 − r)^2`. Expanding: `r = 1 − 2r + r^2`, so `r^2 − 3r + 1 = 0`. By the quadratic formula:

```
r = (3 ± √5) / 2 = (3 − √5)/2 ≈ 0.382   (the smaller root, since 0 < r < 1)
```

That is exactly `1/φ²`, where `φ = (1 + √5)/2`. We immediately check:

```
1/φ² = 1 − 1/φ = 1 − (φ − 1) = 2 − φ = (4 − 1 − √5)/2 = (3 − √5)/2 ✓
```

### Why no other ratio works

Suppose we try `r ≠ 1/φ²`. The old probe `r` is then **not** at a golden-section point of the new interval. Either:
- We move it (impossible — `f(r)` was already evaluated, the value cannot be relocated), or
- We **discard** `f(r)` and evaluate two new probes — back to ternary-search-style two evaluations per step.

Only the golden-ratio choice `r = 1/φ²` (and its mirror `r = 1/φ`) allows recursive reuse. **This is why golden-section search is optimal among "single-new-evaluation-per-step" methods.**

### Connection to Fibonacci search

Discrete Fibonacci search is exactly this scheme on an integer grid. With grid size `F_m`, the probe at offset `F_{m-2}` is at position `F_{m-2}/F_m = (1/φ) × (1/φ) → 1/φ² ≈ 0.382` as `m → ∞`. The two consecutive Fibonacci numbers `F_{m-2}` and `F_{m-1}` carve the integer grid in the same golden-ratio split.

### Convergence rate

Each iteration of golden-section search shrinks the interval by factor `1/φ ≈ 0.618`. After `k` iterations, the interval length is `(1/φ)^k`. To reach precision `ε` on `[0, 1]`:

```
(1/φ)^k ≤ ε  ⇔  k ≥ log_φ(1/ε)
```

So `k = ⌈log_φ(1/ε)⌉` iterations suffice. For `ε = 10^{-9}`, `k ≈ 44`.

Compare: ternary search shrinks by `2/3 ≈ 0.667` per iteration. Iterations: `log_{1.5}(1/ε)`. For `ε = 10^{-9}`, `k ≈ 51`. But ternary uses **2 evaluations per iteration**, so total evaluations are ~102 vs ~45 for golden-section. **Roughly 2.3× fewer evaluations**.

---

<a name="zeckendorf"></a>
## 5. Connection to Zeckendorf Representation

Every positive integer has a unique representation as a sum of **non-consecutive** Fibonacci numbers. This is **Zeckendorf's theorem** (1972, building on work of Lekkerkerker 1952).

### Example

```
13 = F_7 = 13              → 100000 (binary-like, "1" at position 7)
14 = F_7 + F_2 = 13 + 1    → 100001
15 = F_7 + F_3 = 13 + 2    → 100010
16 = F_7 + F_4 = 13 + 3    → 100100
27 = F_8 + F_6 + F_2       → no, F_6+F_2 = 8+1 = 9, F_8 = 21, total = 30, wrong
27 = F_8 + F_4 + F_2 = 21 + 3 + 2  → no, 21+3+2 = 26, wrong
27 = F_8 + F_5 + F_2 = 21 + 5 + 1 = 27 ✓  → 10001010
```

The condition that the chosen Fibonacci numbers are non-consecutive (no two adjacent indices) makes the representation unique.

### Why this matters for search

Each index `i` reached by Fibonacci search has a Zeckendorf representation `i + 1 = F_{a_1} + F_{a_2} + … + F_{a_k}` where the trace of the search through the array corresponds to the sequence of Fibonacci numbers in this decomposition.

In other words, **Fibonacci search is the integer-arithmetic embodiment of the Zeckendorf representation**: each iteration consumes one Fibonacci number from the decomposition of the target index.

This is a beautiful structural result. It means Fibonacci search and Zeckendorf decomposition are dual: searching for `i` in `[0, n)` is equivalent to "consuming" the Zeckendorf decomposition of `i + 1` one term at a time.

### Practical implication

You can implement Fibonacci search by:
1. Precomputing Fibonacci numbers up to `F_m ≥ n + 1`.
2. Maintaining the running "remaining offset" `r`, initially the index range.
3. At each step, the largest Fibonacci `F_k ≤ r` gives the probe distance.

This is mathematically equivalent to the standard algorithm but is sometimes easier to reason about for proving correctness.

### Zeckendorf-based number systems

The Zeckendorf representation is also a **base-φ** number system (informally), with digits 0 and 1 and the constraint of no consecutive 1s. It is used in some compression algorithms (Fibonacci coding for integers with small absolute values) and in certain combinatorial constructions.

---

<a name="lower-bound"></a>
## 6. Lower Bound for Derivative-Free Unimodal Optimization

We now state and sketch Kiefer's lower bound (1953): **golden-section search is optimal** for finding the minimum of a unimodal function in the worst case, up to a constant factor, when only function values are available (no derivatives).

### Theorem (Kiefer, 1953)

For any deterministic algorithm `A` that:
1. Repeatedly chooses probe points `x_1, x_2, …, x_n ∈ [0, 1]` based on past `(x_i, f(x_i))` values,
2. Outputs after `n` evaluations an estimate `x̂` of the minimizer of an unknown unimodal function `f`,

the worst-case error `sup_f |x̂ − arg min f|` is at least `1/F_{n+1}` for `n` evaluations.

### Proof sketch (adversary argument)

The adversary chooses `f` such that:
- The unknown minimum lies in **one** of the subintervals produced by the algorithm's probes.
- After `n` probes, the smallest "definitely contains minimum" subinterval has length at least `1/F_{n+1}` (this is the **Fibonacci bound**, requiring an inductive argument on optimal subdivision strategies).

The bound matches Fibonacci search's performance: after `n` evaluations, Fibonacci search has reduced the bracket to size `1/F_{n+1}`. So **Fibonacci search is exactly optimal** in the worst case among deterministic, derivative-free algorithms.

### Why not golden-section?

Golden-section search is the **infinite-iteration** continuous limit of Fibonacci search. Its convergence rate `(1/φ)^n` matches `1/F_{n+1}` in the limit (since `F_{n+1} ≈ φ^{n+1}/√5`). The difference is that Fibonacci search hits the bound exactly for finite `n`; golden-section is within a constant factor.

In practice, golden-section is preferred because:
- It requires no precomputed Fibonacci table.
- It has cleaner algebra (multiplications by `1/φ` instead of Fibonacci ratios).
- The constant-factor difference is negligible.

### Randomized algorithms

For **randomized** algorithms, the lower bound improves slightly. Yao's minimax principle gives expected error `Ω(1/φ^n)` for any randomized algorithm, matching golden-section search up to constants. Randomization does not asymptotically beat golden-section for this problem.

### Higher dimensions

The 1-D lower bound `Ω(φ^{-n})` does **not** generalize to higher dimensions. In `d` dimensions, the best derivative-free algorithms (e.g., DIRECT, CMA-ES) have rates that depend on `d` exponentially in the worst case. Specialized 1-D coordinate-descent inside higher-dimensional optimizers is one reason golden-section search remains relevant.

---

## Summary of Bounds

| Quantity | Value |
|---|---|
| Worst-case comparisons | `⌈log_φ((n+1)√5)⌉ − 1` ≈ `1.44 log₂ n − 0.33` |
| Average-case comparisons | ≈ `log_φ n − 0.55` |
| Bracket shrink ratio (golden-section, per iteration) | `1/φ ≈ 0.6180` |
| Evaluations for ε precision (golden-section) | `⌈log_φ(1/ε)⌉` |
| Iterative space | `O(1)` |
| Divisions used | **0** |
| Multiplications used (discrete) | **0** |
| Lower bound (derivative-free unimodal, 1-D, deterministic) | `1/F_{n+1}` after `n` evaluations |
| Optimality | Fibonacci search achieves the deterministic 1-D lower bound exactly |

---

## Further Reading

- **Knuth**, *The Art of Computer Programming, Volume 3: Sorting and Searching*, §6.2.1, especially exercises 30, 31, 32, 34. Definitive analysis.
- **Kiefer**, "Sequential Minimax Search for a Maximum," *Proc. AMS* 4 (1953). Original derivation of the optimality of Fibonacci/golden search.
- **Avriel & Wilde**, "Optimality proof for the symmetric Fibonacci search technique," *Fibonacci Quarterly* (1966). Cleaner proof of optimality.
- **Brent**, *Algorithms for Minimization without Derivatives*, 1973, Chapter 5. Foundation of practical golden-section + parabolic hybrids.
- **Zeckendorf**, "Représentation des nombres naturels par une somme de nombres de Fibonacci ou de nombres de Lucas," *Bull. Soc. Roy. Sci. Liège* (1972).
- **Press et al.**, *Numerical Recipes*, §10.2 — implementation details and practical advice.
- **Yao**, "Probabilistic computations: toward a unified measure of complexity," 1977 — randomized lower bound technique.
