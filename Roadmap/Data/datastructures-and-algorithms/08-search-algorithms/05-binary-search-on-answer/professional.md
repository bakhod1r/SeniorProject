# Binary Search on Answer — Mathematical Foundations and Complexity Theory

> **Audience:** Algorithm theorists, researchers, and engineers who want the formal underpinnings — correctness proofs, monotonicity formalism, Megiddo's parametric search lower bounds, the comparison-tree argument, and the cost model for general parametric search over comparison-based decision algorithms.

---

## Table of Contents

1. [Formal Definition](#formal-definition)
2. [Monotonicity — Formal Statement and Equivalences](#monotonicity)
3. [Correctness Proof via Loop Invariant](#correctness)
4. [Megiddo's Parametric Search](#megiddo)
5. [Lower Bound — Why O(log A) is Optimal](#lower-bound)
6. [Real-Valued Convergence and Floating-Point Analysis](#realvalued)
7. [Comparison with Alternatives](#comparison)
8. [Summary](#summary)

---

<a name="formal-definition"></a>
## 1. Formal Definition

```text
Definition (Parametric Search). Let X be a totally ordered set (typically Z or R).
Let P : X -> {0, 1} be a monotonic predicate, meaning:

    For all x, y in X:  x <= y  =>  P(x) <= P(y)        (non-decreasing form)

A Parametric Search instance is a triple (X, P, [lo, hi]) where:
    lo, hi in X with lo <= hi
    P is monotonic on [lo, hi]

The MIN-FEASIBLE problem: find min { x in [lo, hi] : P(x) = 1 } or report "none".
The MAX-FEASIBLE problem: find max { x in [lo, hi] : P(x) = 0 } or report "none".
```

The two problems are *dual*: a max-feasible problem is a min-feasible problem on the reversed (non-increasing) predicate, and vice versa. Without loss of generality we treat the min-feasible form.

For integer `X = Z` we use the discrete bisection algorithm. For continuous `X = R` we use real-valued bisection with epsilon termination or fixed iteration count.

---

<a name="monotonicity"></a>
## 2. Monotonicity — Formal Statement and Equivalences

```text
Definition. A predicate P : X -> {0, 1} on a totally ordered domain X is
non-decreasing if:

    For all x, y in X:  x <= y  =>  P(x) <= P(y)

Equivalent formulations (proof: trivial chain of implications):

    (A)  exists unique threshold t in X u {+inf} such that
         P(x) = 0 for x < t  and  P(x) = 1 for x >= t

    (B)  the level set { x : P(x) = 1 } is upward-closed in X

    (C)  the "boundary set" { x : P(x) != P(x-1) } has cardinality <= 1
         (for integer X, where x-1 is well-defined)
```

The threshold `t` in (A) is precisely the answer of the min-feasible problem. If no such `t` exists in `[lo, hi]` (i.e., `P(hi) = 0`), the problem reports "none". If `t <= lo` (i.e., `P(lo) = 1`), the answer is `lo`.

### Verifying monotonicity in practice

For a candidate predicate `P`, monotonicity can be:

- **Proven directly** by exhibiting a chain `P(x) = 1 => P(x+1) = 1` (the typical case for greedy predicates: more capacity / more time / more budget always works).
- **Disproven by example** by finding any pair `x < y` with `P(x) = 1` and `P(y) = 0`.
- **Suspected from problem structure** when the parameter increases a resource and the predicate tests a feasibility budget — the typical "more X is always at least as good" structure.

**Caution:** monotonicity is a *global* property over `[lo, hi]`. A predicate can be monotonic on `[lo, mid]` and non-monotonic on `[mid, hi]`. Always verify the property holds on the full bracket.

---

<a name="correctness"></a>
## 3. Correctness Proof via Loop Invariant

```text
Algorithm MIN-FEASIBLE(lo, hi, P):
    Precondition: P is non-decreasing on [lo, hi], P(hi) = 1, lo <= hi.
    while lo < hi:
        mid := lo + floor((hi - lo) / 2)
        if P(mid) = 1:
            hi := mid
        else:
            lo := mid + 1
    return lo

Postcondition: lo = min { x in original [lo_0, hi_0] : P(x) = 1 }.
```

```text
Invariant I: At the start of each iteration of the while loop,

    P(hi) = 1  AND  ( lo = lo_0  OR  P(lo - 1) = 0 )

That is: the answer lies in [lo, hi].

Base case (start of first iteration):
    P(hi) = P(hi_0) = 1 by precondition.
    lo = lo_0 by initialisation, so the OR's left disjunct holds.
    Therefore I holds.

Inductive step. Assume I holds at the start of iteration k. Show I holds at iter k+1.
    Let mid := lo + floor((hi - lo) / 2). Note lo <= mid < hi (since lo < hi).

    Case A: P(mid) = 1.
        The update is hi := mid.
        After update: P(new_hi) = P(mid) = 1.  Left of new_lo unchanged.
        Therefore I holds at iter k+1.

    Case B: P(mid) = 0.
        The update is lo := mid + 1.
        After update: lo - 1 = mid, and P(mid) = 0.  Right of new_hi unchanged.
        Therefore I holds at iter k+1.

Termination. Each iteration strictly decreases (hi - lo):
    Case A: new_hi - lo = mid - lo = floor((hi - lo) / 2) < hi - lo when hi - lo >= 1.
    Case B: hi - new_lo = hi - mid - 1 = hi - lo - floor((hi-lo)/2) - 1
                       < hi - lo when hi - lo >= 1.
    The quantity (hi - lo) is a non-negative integer bounded below by 0, so the loop
    terminates after at most O(log(hi_0 - lo_0)) iterations.

Postcondition. At loop exit, lo = hi. By I:
    P(hi) = 1  AND  ( lo = lo_0  OR  P(lo - 1) = 0 )
    so lo is the smallest x in [lo_0, hi_0] with P(x) = 1.  QED.
```

For the max-feasible variant the proof is symmetric: replace `floor` with `ceil` in `mid`, swap the case directions.

---

<a name="megiddo"></a>
## 4. Megiddo's Parametric Search

```text
Generalised problem. Let f(x) be an algorithm whose decision branches depend on
comparisons of the form (a_i(x) <=> 0), where each a_i is a linear (or low-degree
polynomial) function of a parameter x.

Megiddo's idea: simulate f at an "abstract" x. Whenever f wants to test
(a_i(x) <=> 0), we collect this test. After running f to completion, the set of
collected linear inequalities partitions R into regions; the answer is in one of
them. We then binary-search the regions.

Theorem (Megiddo 1983). If the decision algorithm has parallel running time T_p
on P processors, and serial running time T_s, then parametric search runs in
time O(T_s * T_p + T_p * log P).

In particular, if f has O(log n) parallel time on O(n) processors and O(n log n)
serial time, parametric search runs in O(n log^2 n) time.
```

This is the **theoretical version** of parametric search. Coding-interview parametric search is the special case where the abstract simulation collapses to a single explicit predicate `feasible(x)` and the answer space is one-dimensional.

### Why Megiddo matters

Megiddo's framework gives parametric algorithms for:

- Linear programming in fixed dimension in `O(n)`.
- The 1-centre problem (smallest enclosing disc) in `O(n)`.
- The `k`-link shortest path problem.

These are all problems where the answer is a continuous parameter and the decision oracle is itself a non-trivial algorithm. The simple bisection in `junior.md` is the "training-wheel" version.

### Cole's improvement

Richard Cole (1987) improved Megiddo's bound to `O(T_p * (T_s + T_p * log P))` for sorted-input problems, and to `O(n log n)` for the 1-centre. The improvements use a clever weight-balancing scheme on the collected comparisons.

---

<a name="lower-bound"></a>
## 5. Lower Bound — Why O(log A) is Optimal

```text
Theorem. Any deterministic algorithm that solves the min-feasible problem using
only the predicate P as a black-box oracle requires Omega(log A) calls to P,
where A = hi - lo + 1.

Proof. Consider all 2^A possible monotonic predicates on [lo, hi]. Wait —
monotonic predicates on a chain of length A are in bijection with the threshold
t in {lo, lo+1, ..., hi, +inf}, so there are exactly A + 1 distinct monotonic
predicates.

Each oracle call to P at point x returns one bit. After k calls, the algorithm
distinguishes at most 2^k inputs. To distinguish A + 1 inputs, we need:

    2^k >= A + 1   =>   k >= log_2(A + 1) = Omega(log A).

The bisection algorithm achieves k = ceil(log_2(A + 1)) calls. Therefore
bisection is OPTIMAL up to a constant factor.  QED.
```

This decision-tree lower bound is the same shape as the lower bound for comparison sort. Both arise because each query returns one bit, and we need enough bits to disambiguate the input.

### Information-theoretic interpretation

The answer space `[lo, hi]` has entropy `log_2(A) bits`. Each predicate call provides at most 1 bit. Therefore we need at least `log_2(A) calls`. Bisection's `mid` choice maximises the entropy of the predicate call (each call eliminates exactly half the candidates), so bisection is the **information-theoretically optimal** strategy.

---

<a name="realvalued"></a>
## 6. Real-Valued Convergence and Floating-Point Analysis

For `X = R`, the bisection algorithm cannot terminate at `lo == hi` because real subtraction can fail to converge to zero in floating-point. Two termination strategies:

### 6.1 Epsilon termination

```text
while hi - lo > epsilon:
    mid = (lo + hi) / 2
    if P(mid): hi = mid else: lo = mid
return (lo + hi) / 2
```

```text
Convergence rate. After k iterations, hi - lo <= (hi_0 - lo_0) * 2^(-k).
To reach precision epsilon:  k >= log_2((hi_0 - lo_0) / epsilon).

Catch: For double-precision floats (53-bit mantissa), epsilon below
2^(-53) * max(|lo|, |hi|) is unattainable due to rounding.
At |lo| = |hi| = 10^6, the smallest meaningful epsilon is ~10^-10.
```

### 6.2 Fixed-iteration termination

```text
for i in range(100):
    mid = (lo + hi) / 2
    if P(mid): hi = mid else: lo = mid
return (lo + hi) / 2
```

Why 100? After 100 halvings, the bracket has shrunk by 2^100 ≈ 10^30, vastly exceeding any meaningful precision. This terminates in bounded time regardless of how slowly the bracket shrinks in floating-point arithmetic.

### Floating-point pitfalls

- `(lo + hi) / 2` can overflow for huge `lo, hi`. Use `lo + (hi - lo) / 2`.
- For `lo = 0` and very small `hi`, `(lo + hi) / 2` can underflow.
- When `lo` and `hi` are both very negative, comparison still works because IEEE-754 ordering is well-defined.
- `NaN` in the predicate breaks monotonicity. Filter inputs.

---

<a name="comparison"></a>
## 7. Comparison with Alternatives

| Attribute | Bisection | Newton iteration | Ternary search | Golden-section search | Megiddo parametric |
|---|---|---|---|---|---|
| Requires monotonicity | Yes | No (needs differentiability) | Unimodal | Unimodal | Yes |
| Convergence rate | Linear (1 bit/iter) | Quadratic | Linear (log_{3/2}) | Linear (log_phi) | Polynomial in T_s, T_p |
| Number of evaluations | log_2(A) | 5–10 typically | log_{3/2}(A) | log_phi(A) ≈ 1.44 log_2 | T_s * T_p / P |
| Handles continuous | Yes | Yes | Yes | Yes | Yes |
| Discrete only? | No | No (needs derivative) | Discrete with care | No | No |
| Robust to noise | Poor | Very poor | Poor | Poor | Inherits decision-alg robustness |
| Theoretical optimality | Yes (decision tree) | No | No | Yes for unimodal | Yes via Cole's improvement |
| Cache I/Os | O(log A) | O(log log A) | O(log A) | O(log A) | Same as decision alg |
| Determinism | Yes | Yes | Yes | Yes | Yes |
| Use case | Monotonic predicates | Smooth functions with derivatives | Unimodal functions | Unimodal functions, no derivative | LP, geometric optimisation |

---

<a name="summary"></a>
## 8. Summary

- Parametric search is **formally defined** as bisection over a monotonic predicate; the formalism requires only a totally ordered domain and the level-set-upward-closed property.
- **Correctness** is proven by a one-line loop invariant: the answer lies in `[lo, hi]` at the start of every iteration; the predicate evaluations at `mid` preserve this invariant; termination follows from the integer well-ordering principle.
- **Megiddo's theorem** generalises parametric search to any comparison-based decision algorithm and gives an `O(T_s * T_p)` bound; Cole's improvement tightens it for sorted inputs.
- The **decision-tree lower bound** shows `O(log A)` is optimal for any black-box oracle algorithm — bisection matches it within a constant.
- **Real-valued bisection** terminates via epsilon or fixed iteration count; floating-point analysis bounds achievable precision at ~10⁻¹⁵ relative.
- Bisection is **optimal among monotonic-predicate algorithms** but suboptimal for differentiable or unimodal functions, where Newton's method or golden-section search are faster.

At professional level, parametric search is no longer a coding trick — it is a formally specified algorithm whose correctness, optimality, and limits are precisely understood.
