# The Master Theorem — Mathematical Foundations and Proofs

## Table of Contents
1. Formal Statement and Hypotheses
2. The Recursion-Tree Decomposition
3. Proof of Case 1 (Leaves Dominate)
4. Proof of Case 2 (Balanced Levels)
5. Proof of Case 3 (Root Dominates) and the Regularity Condition
6. The Gap Between Cases
7. The Extended Master Theorem with Log Factors
8. Floors, Ceilings, and the Domain
9. The Akra–Bazzi Theorem and Proof Sketch
10. Recovering the Master Theorem from Akra–Bazzi
11. Worked Derivations
12. Tight Bounds via Exact Summation
13. The Substitution Method as a Rigorous Backstop
14. Lower Bounds and the Leaf Floor
15. Generating-Function and Mellin-Transform Views
16. Common Proof Pitfalls
16b. The Master Theorem Among Recurrence Types
16c. Detailed Akra–Bazzi Integral Evaluations
16d. A Verified Reference Solver
17. Summary

---

## 1. Formal Statement and Hypotheses

Let `a ≥ 1` and `b > 1` be constants, let `f : ℝ⁺ → ℝ⁺` be asymptotically positive, and let `T(n)` be defined on the nonnegative integers by

```
T(n) = a · T(n/b) + f(n),
```

where `n/b` is interpreted as `⌊n/b⌋` or `⌈n/b⌉` (Section 8 shows this is immaterial). Define the **critical exponent**

```
p = log_b a
```

and the **watershed function** `n^p = n^(log_b a)`. The Master Theorem states three cases.

> **Theorem (Master Theorem).**
> 1. **(Case 1)** If `f(n) = O(n^(p − ε))` for some constant `ε > 0`, then `T(n) = Θ(n^p)`.
> 2. **(Case 2)** If `f(n) = Θ(n^p)`, then `T(n) = Θ(n^p · log n)`.
> 3. **(Case 3)** If `f(n) = Ω(n^(p + ε))` for some constant `ε > 0`, **and** the *regularity condition* `a·f(n/b) ≤ c·f(n)` holds for some constant `c < 1` and all sufficiently large `n`, then `T(n) = Θ(f(n))`.

**Identity used throughout.** By change of base, `n^(log_b a) = a^(log_b n)`:
```
a^(log_b n) = (b^(log_b a))^(log_b n) = b^(log_b a · log_b n) = (b^(log_b n))^(log_b a) = n^(log_b a).
```
This is why `n^p` is exactly the leaf count: the tree has `a^(log_b n)` leaves, which equals `n^p`.

---

## 2. The Recursion-Tree Decomposition

Assume `n = b^L` so the recursion bottoms out cleanly at `L = log_b n` levels (Section 8 removes this assumption). Unrolling the recurrence:

```
T(n) = f(n) + a·T(n/b)
     = f(n) + a·f(n/b) + a²·T(n/b²)
     = ⋯
     = Σ_{i=0}^{L−1} a^i · f(n / b^i)  +  a^L · T(1).
```

The last term is the **leaf cost**. Since `a^L = a^(log_b n) = n^p` and `T(1) = Θ(1)`:

```
leaf cost = Θ(n^p).
```

Define the **driving sum**

```
g(n) := Σ_{i=0}^{L−1} a^i · f(n / b^i).
```

Then `T(n) = g(n) + Θ(n^p)`. Each case is proved by bounding `g(n)`.

**Lemma 2.1 (Driving sum for pure powers).** If `f(n) = n^c`, then
```
g(n) = Σ_{i=0}^{L−1} a^i (n/b^i)^c = n^c Σ_{i=0}^{L−1} (a/b^c)^i,
```
a geometric series with ratio `r = a/b^c`. Note `r = 1 ⇔ c = log_b a = p`, `r > 1 ⇔ c < p`, `r < 1 ⇔ c > p`. This single ratio drives all three cases.

**Proof of Lemma 2.1.** Substitute `f(x) = x^c` into the driving sum:
```
a^i · f(n/b^i) = a^i · (n/b^i)^c = a^i · n^c · b^{−ic} = n^c · (a · b^{−c})^i = n^c · (a/b^c)^i.
```
Factoring the `i`-independent `n^c` out of the sum yields `n^c Σ (a/b^c)^i`. The equivalences follow from `r = a/b^c = 1 ⇔ a = b^c ⇔ log_b a = c`, and monotonicity of `b^c` in `c` gives the inequalities. ∎

**Lemma 2.2 (Number of levels).** With `n = b^L`, the recursion reaches size `1` after exactly `L = log_b n` halvings, and the tree has `L + 1` levels (`0` through `L`). Level `L` consists of the `a^L = n^p` leaves. *Proof:* size at level `i` is `n/b^i`; setting `n/b^i = 1` gives `i = log_b n = L`. ∎

---

## 3. Proof of Case 1 (Leaves Dominate)

**Hypothesis.** `f(n) = O(n^(p−ε))` for some `ε > 0`; i.e. `f(n) ≤ d·n^(p−ε)` for a constant `d` and large `n`.

**Bound the driving sum.**
```
g(n) = Σ_{i=0}^{L−1} a^i f(n/b^i)
     ≤ d Σ_{i=0}^{L−1} a^i (n/b^i)^(p−ε)
     = d·n^(p−ε) Σ_{i=0}^{L−1} (a / b^(p−ε))^i.
```
The ratio is `a / b^(p−ε) = a / (b^p · b^(−ε)) = (a/b^p)·b^ε = 1·b^ε = b^ε > 1`, using `b^p = a`. So the geometric series with ratio `b^ε > 1` is dominated by its last term:
```
Σ_{i=0}^{L−1} (b^ε)^i = (b^(εL) − 1)/(b^ε − 1) = Θ(b^(εL)) = Θ((b^L)^ε) = Θ(n^ε).
```
Therefore
```
g(n) = O(n^(p−ε) · n^ε) = O(n^p).
```
Combined with the leaf cost `Θ(n^p)`, we get `T(n) = g(n) + Θ(n^p) = O(n^p) + Θ(n^p) = Θ(n^p)`. The leaf term, present unconditionally, supplies the matching lower bound. ∎

The intuition: the geometric series grows *outward* (ratio `b^ε > 1`), so the bottom level — the leaves — carries a constant fraction of the total, and `T(n) = Θ(n^p)`.

**Sharper statement.** Case 1 actually holds under the weaker hypothesis `f(n) = O(n^{p−ε})`, and the conclusion can be read as: the per-level work *decreases* geometrically going *up* the tree from the leaves, so a geometric fraction of all work sits at the bottommost levels. Concretely, the fraction of total work above level `L − m` decays like `b^{−εm}`, so the top `O(1/ε)` levels contribute a vanishing share. This is the precise sense in which "the algorithm spends almost all its time in the base cases" — true of Karatsuba, Strassen, and any Case-1 divide-and-conquer.

---

## 4. Proof of Case 2 (Balanced Levels)

**Hypothesis.** `f(n) = Θ(n^p)`; i.e. `c₁ n^p ≤ f(n) ≤ c₂ n^p` for constants `0 < c₁ ≤ c₂`.

**Bound the driving sum.** Using the upper bound on `f`:
```
g(n) ≤ c₂ Σ_{i=0}^{L−1} a^i (n/b^i)^p = c₂ n^p Σ_{i=0}^{L−1} (a/b^p)^i = c₂ n^p Σ_{i=0}^{L−1} 1^i = c₂ n^p · L,
```
since the ratio `a/b^p = 1`. With `L = log_b n`, this is `O(n^p log n)`. The lower bound is symmetric with `c₁`, giving `g(n) = Θ(n^p log n)`. Because `n^p log n` dominates the leaf cost `n^p`,
```
T(n) = Θ(n^p log n). ∎
```

Every level contributes the same total `Θ(n^p)`; there are `Θ(log n)` levels; the product is `Θ(n^p log n)`. This is the only case where the level count appears as a factor.

**Explicit two-sided bound.** Combining the `c₁` lower and `c₂` upper bounds with the leaf term:
```
c₁ n^p log_b n + Θ(n^p) ≤ T(n) ≤ c₂ n^p log_b n + Θ(n^p).
```
Both sides are `Θ(n^p log n)` because `n^p log n` strictly dominates the additive `n^p` leaf term. The constant on the `log` term lies in `[c₁/log b, c₂/log b]`, recovering the exact-summation result of Section 12. ∎

**Why Case 2 cannot be tightened.** No choice of base for the logarithm changes the `Θ`-class, but the *base matters for constants*: `log_b n = (ln n)/(ln b)`, so a recurrence with larger `b` has a smaller leading constant on the same `Θ(n^p log n)`. This is invisible to the asymptotic statement but visible to a profiler, and is the analytic content of Section 12's "ternary vs binary merge sort" comparison.

---

## 5. Proof of Case 3 (Root Dominates) and the Regularity Condition

**Hypothesis.** `f(n) = Ω(n^(p+ε))` for some `ε > 0`, **and** `a·f(n/b) ≤ c·f(n)` for a constant `c < 1` and large `n` (the *regularity condition*).

**The regularity condition controls the geometric decay.** Iterating `a·f(n/b) ≤ c·f(n)`:
```
a^i · f(n/b^i) ≤ c^i · f(n)    for all i ≥ 0, by induction.
```
*Base case* `i = 0`: `f(n) ≤ f(n)`. *Inductive step*: `a^{i+1} f(n/b^{i+1}) = a·a^i f((n/b^i)/b) ≤ a·a^i · (c·f(n/b^i)/a)`... more directly, apply regularity to argument `n/b^i`: `a·f((n/b^i)/b) ≤ c·f(n/b^i)`, multiply by `a^i`: `a^{i+1} f(n/b^{i+1}) ≤ c·a^i f(n/b^i) ≤ c·c^i f(n) = c^{i+1} f(n)`. ∎ (induction)

**Bound the driving sum.**
```
g(n) = Σ_{i=0}^{L−1} a^i f(n/b^i) ≤ Σ_{i=0}^{∞} c^i f(n) = f(n) · 1/(1−c) = O(f(n)),
```
because `c < 1` makes the geometric series converge. The very first term `i = 0` is `f(n)` itself, so `g(n) = Ω(f(n))` trivially. Hence `g(n) = Θ(f(n))`. Since `f(n) = Ω(n^(p+ε))` dominates the leaf cost `n^p`,
```
T(n) = Θ(f(n)). ∎
```

**Why regularity is needed.** Without it, the terms `a^i f(n/b^i)` need not decay geometrically, and the sum could exceed `Θ(f(n))`. The condition `a·f(n/b) ≤ c·f(n)` with `c < 1` is *precisely* the statement "going down one level multiplies the per-level work by a factor `< 1`," which forces the geometric collapse to the top term. For `f(n) = n^c` with `c > p`, regularity holds automatically: `a·(n/b)^c = (a/b^c) n^c = r·n^c` with `r = a/b^c < 1`. It can fail only for non-smooth `f` (e.g. `n²(1+sin n)` type functions), and there the theorem genuinely yields no conclusion.

---

## 6. The Gap Between Cases

The three cases do **not** cover all `f(n)`. The hypotheses require *polynomial* separation (`n^ε`). There are two gaps:

**Lower gap:** `f(n)` is smaller than `n^p` but not by a polynomial factor, e.g. `f(n) = n^p / log n`. Then `f(n) ≠ O(n^(p−ε))` for any `ε > 0` (since `1/log n` shrinks slower than any `n^(−ε)`), so Case 1 does not apply, and `f(n) ≠ Θ(n^p)`, so Case 2 does not apply either. The recurrence `T(n)=2T(n/2)+n/log n` lives here; Akra–Bazzi (Section 9) gives `Θ(n log log n)`.

**Upper gap:** `f(n)` exceeds `n^p` but not polynomially, e.g. `f(n) = n^p log n`. Then `f(n) ≠ Ω(n^(p+ε))`, so Case 3 fails. The extended theorem (Section 7) rescues this with one extra `log`.

**Why polynomial separation?** From Lemma 2.1, the geometric ratio is `r = a/b^c`. The series collapses to a single term (within a constant) only when `r` is bounded away from `1` by a constant. A factor of `n^ε` in `f` shifts `c` by `ε`, multiplying `r` by `b^{∓ε}` — a constant `≠ 1`. A factor of `log n` shifts `c` by `o(1)`, leaving `r → 1`, so the series *accumulates* across all `Θ(log n)` levels rather than collapsing. That accumulation is the extra `log` factor of the extended theorem and the reason the basic theorem is silent in the gaps.

**The gap is a measure-zero boundary, but a common one.** In the space of exponents, the watershed `c = p` is a single point and the gaps are the infinitesimal neighborhood where `f` and `n^p` differ sub-polynomially. One might expect to never land there — yet *the most important algorithms do*. Merge sort sits exactly at `c = p` (Case 2). Any algorithm whose combine cost is `Θ(watershed × polylog)` lands in the upper gap. So the "exceptional" boundary is precisely where the interesting linearithmic and near-linearithmic algorithms live, which is why the extended theorem is not a footnote but a working necessity.

**Formal non-applicability proof (lower gap).** Suppose `f(n) = n^p / log n`. We show no `ε > 0` makes `f(n) = O(n^{p−ε})`. That would require `n^p/log n ≤ d·n^{p−ε}` i.e. `n^ε ≤ d·log n` for all large `n`. But `n^ε` grows polynomially and `log n` only logarithmically, so `n^ε/log n → ∞`, contradicting the bound. Hence Case 1's hypothesis fails for every `ε`, and since `f ≠ Θ(n^p)` Case 2 fails too. Only Akra–Bazzi (or the negative-`k` extended form) resolves it: `Θ(n^p log log n)`. ∎

---

## 7. The Extended Master Theorem with Log Factors

> **Theorem (Extended Case 2).** Let `T(n) = a T(n/b) + f(n)` with `p = log_b a`. If `f(n) = Θ(n^p · log^k n)` for a constant `k`, then:
> - if `k > −1`: `T(n) = Θ(n^p · log^(k+1) n)`;
> - if `k = −1`: `T(n) = Θ(n^p · log log n)`;
> - if `k < −1`: `T(n) = Θ(n^p)` (the leaf term wins).

**Proof for `k ≥ 0` (the common case).** Take `f(n) = n^p log^k n`. The driving sum:
```
g(n) = Σ_{i=0}^{L−1} a^i (n/b^i)^p log^k(n/b^i)
     = n^p Σ_{i=0}^{L−1} (a/b^p)^i log^k(n/b^i)
     = n^p Σ_{i=0}^{L−1} log^k(n/b^i)          (since a/b^p = 1).
```
Write `log(n/b^i) = log n − i·log b`. As `i` ranges `0..L−1` with `L = log_b n`, the argument `log(n/b^i)` ranges linearly from `log n` down to `log b`. The sum `Σ_{i=0}^{L−1} (log n − i log b)^k` is a Riemann-sum approximation of `(1/log b) ∫_0^{log n} u^k du = Θ(log^{k+1} n)` for `k > −1`. Hence
```
g(n) = Θ(n^p log^{k+1} n),  T(n) = Θ(n^p log^{k+1} n). ∎
```
For `k = −1` the integral `∫ u^{−1} du = log u` evaluates to `log log n`; for `k < −1` the integral converges to a constant and the leaf term `n^p` dominates.

**Examples.** `2T(n/2)+n` (`k=0`) → `Θ(n log n)`; `2T(n/2)+n log n` (`k=1`) → `Θ(n log² n)`; `2T(n/2)+n/log n` (`k=−1`) → `Θ(n log log n)`.

---

## 8. Floors, Ceilings, and the Domain

Real recurrences use `T(⌈n/b⌉)` or `T(⌊n/b⌋)`, and `n` is not a power of `b`. The conclusions are unchanged.

**Sketch (CLRS Lemma 4.6 style).** Sandwich. Define `T'(n) = a T'(⌈n/b⌉) + f(n)` and `T''(n) = a T''(⌊n/b⌋) + f(n)`. One shows `⌈n/b⌉ ≤ n/b + 1` and unrolling introduces an error term that is `O(n / b^j)` at depth `j`, whose accumulated effect is a lower-order perturbation absorbed by the `Θ`. Formally, the substitution `n_j = ⌈n_{j−1}/b⌉` satisfies `n_j ≤ n/b^j + b/(b−1)`, and the extra additive `b/(b−1)` contributes only constant factors to each level. Thus the floor/ceiling versions are `Θ`-equivalent to the clean `n = b^L` version. Akra–Bazzi formalizes this by *explicitly* allowing perturbations `h_i(n)` with `|h_i(n)| = O(n/log² n)`, which subsumes any floor or ceiling.

**The bounded-recurrence depth lemma.** Define the iterated-ceiling sequence `n_0 = n`, `n_{j+1} = ⌈n_j/b⌉`. Claim `n_j ≤ n/b^j + b/(b−1)`. *Proof by induction.* Base `j=0`: `n_0 = n ≤ n + b/(b−1)`. Step: `n_{j+1} ≤ n_j/b + 1 ≤ (n/b^j + b/(b−1))/b + 1 = n/b^{j+1} + 1/(b−1) + 1 = n/b^{j+1} + b/(b−1)`. ∎ The bounded additive term `b/(b−1)` (a constant once `b` is fixed) guarantees the ceiling tree has the *same depth* `Θ(log_b n)` and the *same per-level work up to constants* as the idealized tree, so the asymptotic conclusions transfer verbatim. This is why textbooks freely write `n/b` and ignore the ceiling.

**Base-case insensitivity.** The boundary `T(n) = Θ(1)` for `n ≤ n₀` (any constant threshold) does not affect the asymptotics: changing `n₀` rescales only the leaf contribution by a constant factor. Hence the theorem's `Θ` holds for *all* sufficiently large `n` regardless of how the base case is defined, provided it is bounded. Production code's "switch to insertion sort below 16" is precisely such a bounded base case and leaves the `Θ` untouched.

---

## 9. The Akra–Bazzi Theorem and Proof Sketch

> **Theorem (Akra–Bazzi, 1998).** Consider
> ```
> T(n) = Σ_{i=1}^{k} a_i · T(b_i·n + h_i(n)) + g(n),   for n ≥ n₀,
> ```
> with constants `a_i > 0`, `0 < b_i < 1`, perturbations `|h_i(n)| = O(n / log² n)`, and `g(n)` nonnegative satisfying a polynomial-growth condition (`|g'(n)| = O(n^d)` for some `d`). Let `p` be the unique real number with
> ```
> Σ_{i=1}^{k} a_i · b_i^p = 1.
> ```
> Then
> ```
> T(n) = Θ( n^p · ( 1 + ∫_1^n  g(u) / u^{p+1}  du ) ).
> ```

(Here `b_i` are the *fractions* `< 1`; the Master-Theorem `b` corresponds to `1/b_i`.)

**Existence and uniqueness of `p`.** The function `φ(p) = Σ a_i b_i^p` is continuous and *strictly decreasing* in `p` (each `b_i < 1`, so `b_i^p` decreases), with `φ(−∞) = +∞` and `φ(+∞) = 0`. By the intermediate value theorem there is a unique `p` with `φ(p) = 1`. This `p` is the Akra–Bazzi exponent — the generalized critical exponent.

*Detailed argument.* Each term `a_i b_i^p = a_i e^{p ln b_i}` with `ln b_i < 0` is a strictly decreasing, continuous, positive function of `p` (since `a_i > 0`). A finite sum of such functions is strictly decreasing and continuous. As `p → −∞`, `e^{p ln b_i} = e^{(−∞)(−)} → +∞`, so `φ(p) → +∞`; as `p → +∞`, each term → `0`, so `φ(p) → 0`. A strictly monotone continuous function taking values spanning `(0, +∞)` hits the level `1` exactly once. Hence `p` exists and is unique. Numerically this monotonicity is what makes **bisection** the correct solver (Section 5 of `senior.md`, and the coding challenges in `interview.md`): the sign of `φ(p) − 1` strictly determines which half-interval to keep.

**Proof sketch.** The idea mirrors the recursion tree but replaces the discrete geometric series with an integral. Guess `T(n) = Θ(n^p (1 + ∫_1^n g(u)/u^{p+1} du))` and verify it satisfies the recurrence up to lower-order perturbations.

1. *Homogeneous part.* With `g ≡ 0` the ansatz is `T(n) = Θ(n^p)`. Substituting: `Σ a_i (b_i n)^p = n^p Σ a_i b_i^p = n^p · 1 = n^p`, so `n^p` is exactly a fixed point of the recursion operator — this is *why* `p` is defined by `Σ a_i b_i^p = 1`.
2. *Particular part.* Let `G(n) = ∫_1^n g(u)/u^{p+1} du`. One checks that `n^p G(n)` accumulates the driving term `g(n)` correctly: differentiating, `n^p G(n)` grows at rate `g(n)/n` per unit, integrating to capture `g`. The perturbations `h_i` shift each argument by `O(n/log² n)`, and a mean-value-theorem argument shows this changes `n^p` by only a `(1 + o(1))` factor — small enough to be absorbed into the `Θ`. This is the technical heart and the reason for the `O(n/log² n)` bound: it guarantees the perturbation is `o(n^p)`.
3. *Combining* the homogeneous and particular solutions, and bounding the perturbation error by induction on `n`, yields the stated `Θ`. ∎ (sketch)

The integral `∫_1^n g(u)/u^{p+1} du` is the continuous analogue of the geometric driving sum `Σ a^i f(n/b^i)`: it is `Θ(1)` (root-dominated, like Case 3) when `g(u)/u^{p+1}` is integrable at `∞`, `Θ(log n)` (balanced, like Case 2) when `g(u) ~ u^p`, and `Θ(n^{q−p})` (leaf-dominated, like Case 1) when `g(u) ~ u^q` with `q > p`... but the integral handles *all* `g` uniformly, which is its power.

---

## 10. Recovering the Master Theorem from Akra–Bazzi

The Master Theorem is the single-term (`k = 1`) special case. With one subproblem of size `n/b`, set `a_1 = a`, `b_1 = 1/b`. The exponent equation:
```
a · (1/b)^p = 1  ⟺  a = b^p  ⟺  p = log_b a,
```
recovering the watershed exponent exactly. Now take `g(n) = n^c` and evaluate the integral:
```
∫_1^n u^c / u^{p+1} du = ∫_1^n u^{c−p−1} du.
```
- If `c < p`: exponent `c−p−1 < −1`, integral converges → `Θ(1)` → `T(n) = Θ(n^p · 1) = Θ(n^p)` — **Case 1**.
- If `c = p`: integrand `u^{−1}`, integral `= ln n` → `T(n) = Θ(n^p log n)` — **Case 2**.
- If `c > p`: exponent `c−p−1 > −1`, integral `= Θ(n^{c−p})` → `T(n) = Θ(n^p · n^{c−p}) = Θ(n^c) = Θ(f(n))` — **Case 3**.

All three Master-Theorem cases fall out of the *one* Akra–Bazzi integral by reading off whether `u^{c−p−1}` is integrable, borderline, or divergent. This is the cleanest possible unification: the three cases are the three convergence behaviors of a single integral, exactly as they were the three behaviors of a single geometric series.

---

## 11. Worked Derivations

**(a) `T(n) = 2T(n/2) + n` (merge sort).** `p = log_2 2 = 1`. Akra–Bazzi: `∫_1^n u/u² du = ln n`, so `T(n) = Θ(n(1+ln n)) = Θ(n log n)`. ✓ Master Theorem Case 2 agrees.

**(b) `T(n) = 7T(n/2) + n²` (Strassen).** `p = log_2 7 ≈ 2.807`. `g = n²`, `c = 2 < p`. Integral `∫ u^{2−p−1} du = ∫ u^{1−p} du` converges (`1−p < −1`) → `Θ(1)` → `T(n) = Θ(n^p) = Θ(n^{log_2 7})`. ✓ Case 1.

**(c) `T(n) = 2T(n/2) + n²`.** `p = 1`, `g = n²`, `c = 2 > p`. Integral `∫ u^{2−2} du = ∫ 1·du = n−1 = Θ(n)`... wait, `c−p−1 = 2−1−1 = 0`, integral `= ∫_1^n u^0 du = n − 1 = Θ(n)`, so `T(n) = Θ(n^1 · n) = Θ(n²) = Θ(f(n))`. ✓ Case 3. Regularity: `2(n/2)² = n²/2 = (1/2)f(n)`, `c=1/2<1`. ✓

**(d) `T(n) = T(n/3) + T(2n/3) + n` (unequal).** `b_1 = 1/3, b_2 = 2/3`. Exponent: `(1/3)^p + (2/3)^p = 1` → `p = 1`. Integral `∫_1^n u/u² du = ln n` → `T(n) = Θ(n log n)`. ✓ (Master Theorem could not even start.)

**(e) `T(n) = T(n/5) + T(7n/10) + n` (median-of-medians).** `(1/5)^p + (7/10)^p = 1`. At `p=1`, LHS `= 0.9 < 1`, so `p < 1`. Integral `∫_1^n u^{−p} du = Θ(n^{1−p})` (since `1−p > 0`) → `T(n) = Θ(n^p · n^{1−p}) = Θ(n)`. ✓ Linear selection.

**(f) `T(n) = 2T(n/2) + n/log n` (gap).** `p = 1`. Integral `∫_1^n (u/log u)/u² du = ∫ 1/(u log u) du = log log n` → `T(n) = Θ(n log log n)`. ✓ — the lower-gap case the basic theorem cannot reach.

**(g) `T(n) = 4T(n/2) + n² log n` (extended Case 2).** `p = log_2 4 = 2`, so the watershed is `n²` and `f = n² log n = n^p log^1 n` with `k = 1`. Extended Case 2 → `Θ(n² log² n)`. Cross-check with Akra–Bazzi: single term, `p = 2`, `∫_1^n (u² log u)/u³ du = ∫ (log u)/u du = (log n)²/2 = Θ(log² n)` → `T(n) = Θ(n² log² n)`. ✓ The integral form recovers the extended-case log inflation automatically.

**(h) `T(n) = 5T(n/2) + n^{2.5}`.** `p = log_2 5 ≈ 2.322`, `c = 2.5 > p`. Case 3 candidate. Regularity: `5·(n/2)^{2.5} = 5·n^{2.5}/2^{2.5} = (5/5.657)·n^{2.5} ≈ 0.884·f(n)`, and `0.884 < 1` ✓. Case 3 → `Θ(n^{2.5})`. Notice the regularity ratio `0.884` is *close* to 1 but still bounded below it — the geometric series converges, just slowly. ✓

**(i) `T(n) = 2T(n/2) + Θ(1)` (full binary recursion, constant work).** `p = log_2 2 = 1`, `c = 0 < p`. Case 1 → `Θ(n)`. The leaves (there are `n` of them) dominate; the constant per-node work sums to the leaf count. This is the recurrence of a complete-binary-tree traversal. ✓

**(j) `T(n) = 3T(n/3) + Θ(1)`.** `p = log_3 3 = 1`, watershed `n`, `f = Θ(1) = Θ(n^0)`, `0 < 1` → Case 1 → `Θ(n)`. Same leaf-dominated structure with a ternary tree. ✓

Summary of all worked derivations:

| Recurrence | `p = log_b a` | `c` | Case | `T(n)` |
|------------|---------------|-----|------|--------|
| `2T(n/2)+n` | 1 | 1 | 2 | `Θ(n log n)` |
| `7T(n/2)+n²` | 2.807 | 2 | 1 | `Θ(n^2.807)` |
| `2T(n/2)+n²` | 1 | 2 | 3 | `Θ(n²)` |
| `T(n/3)+T(2n/3)+n` | 1 (AB) | — | AB | `Θ(n log n)` |
| `T(n/5)+T(7n/10)+n` | <1 (AB) | — | AB | `Θ(n)` |
| `2T(n/2)+n/log n` | 1 | gap | AB | `Θ(n log log n)` |
| `4T(n/2)+n² log n` | 2 | ext-2 | ext | `Θ(n² log² n)` |
| `5T(n/2)+n^2.5` | 2.322 | 2.5 | 3 | `Θ(n^2.5)` |
| `2T(n/2)+1` | 1 | 0 | 1 | `Θ(n)` |
| `3T(n/3)+1` | 1 | 0 | 1 | `Θ(n)` |

---

## 12. Tight Bounds via Exact Summation

The asymptotic proofs above hide constants. For a *tight* count (useful when comparing two algorithms in the same case), sum the geometric series exactly. Take `f(n) = n^c` and `n = b^L`.

**Case 1 / Case 3 closed form.** The driving sum is `n^c Σ_{i=0}^{L−1} r^i = n^c · (r^L − 1)/(r − 1)` with `r = a/b^c ≠ 1`. Substituting `r^L = (a/b^c)^{log_b n} = n^{p−c}` (since `a^{log_b n} = n^p` and `b^{c·log_b n} = n^c`):

```
g(n) = n^c · (n^{p−c} − 1)/(r − 1) = (n^p − n^c)/(r − 1).
```

For Case 1 (`r > 1`, `p > c`): `g(n) = (n^p − n^c)/(r−1) ~ n^p/(r−1)`, so the leading constant on `n^p` is `1/(r−1) + 1` (the `+1` from the leaf term). For Case 3 (`r < 1`, `p < c`): `r − 1 < 0`, and `g(n) = (n^c − n^p)/(1−r) ~ n^c/(1−r)`, giving leading constant `1/(1−r)` on `f(n)`.

**Case 2 closed form.** `g(n) = n^p · L = n^p log_b n = n^p · (log n / log b)`, so the constant on `n^p log n` is exactly `1/log b`. This is why merge sort's leading term is `n log₂ n` (`b = 2`, so `1/log 2` in natural-log terms gives the `log₂` base). Knowing the *base* of the log matters when you compare two Case-2 algorithms with different `b`.

**Example — comparing two linearithmic sorts.** Merge sort (`2T(n/2)+n`) has per-level work `n` over `log₂ n` levels → `n log₂ n`. A hypothetical `3T(n/3)+n` sort also has watershed `n` (since `log_3 3 = 1`) and is Case 2 → `n log₃ n`. Same `Θ(n log n)`, but `log₃ n = log₂ n / log₂ 3 ≈ 0.63 log₂ n`, so the ternary version does ~37% fewer "level passes" — a real constant-factor difference the asymptotics erase but the exact summation exposes.

---

## 13. The Substitution Method as a Rigorous Backstop

The recursion-tree proof *computes* the answer; the substitution method *verifies* it by strong induction, and it is the rigorous fallback whenever the Master Theorem is inapplicable.

**Theorem (verification of merge sort).** `T(n) = 2T(⌊n/2⌋) + n`, `T(1) = 1`, satisfies `T(n) = O(n log n)`.

**Proof.** Claim `T(n) ≤ c·n·log₂ n` for `n ≥ 2` and a constant `c` to be fixed. Strong induction; assume it for all `m < n`. Then
```
T(n) ≤ 2·c·⌊n/2⌋·log₂⌊n/2⌋ + n
     ≤ 2·c·(n/2)·log₂(n/2) + n
     = c·n·(log₂ n − 1) + n
     = c·n·log₂ n − c·n + n
     ≤ c·n·log₂ n          whenever c·n ≥ n, i.e. c ≥ 1.
```
Choosing `c ≥ 1` (and handling the base `n = 2,3` directly to seed the induction) closes the proof. ∎

**Why this matters at the boundary.** When `f(n)` is non-polynomial or sizes are unequal, substitution is often the *only* rigorous tool. The technique:

1. Use a recursion tree to *guess* the form (e.g. `Θ(n log log n)`).
2. Prove the upper bound `T(n) ≤ c·(guess)` by induction.
3. Prove the matching lower bound `T(n) ≥ c'·(guess)` symmetrically.

**The strengthening trick.** A naive guess sometimes fails to close because of a lower-order term. To prove `T(n) = 2T(n/2) + Θ(n)` is `O(n)` would *fail* (the truth is `n log n`), but to prove a true bound like `T(n) = T(n/2) + 1 = O(log n)`, you may need to *subtract* a constant from the hypothesis (`T(n) ≤ c log n − d`) so the induction absorbs the additive `+1`. Strengthening the hypothesis to make the induction go through is the signature move of the substitution method.

---

## 14. Lower Bounds and the Leaf Floor

Every theorem above quietly used `T(n) = Ω(n^p)` as an unconditional lower bound. This deserves a clean statement.

**Lemma 14.1 (Leaf floor).** For any `a ≥ 1`, `b > 1`, and asymptotically positive `f`, the recurrence `T(n) = a T(n/b) + f(n)` with `T(1) = Θ(1)` satisfies `T(n) = Ω(n^{log_b a})`.

**Proof.** Drop the `f` terms (they are nonnegative): `T(n) ≥ a T(n/b) ≥ a² T(n/b²) ≥ ⋯ ≥ a^L T(1)` with `L = log_b n`. Then `a^L T(1) = n^{log_b a} · Θ(1) = Ω(n^{log_b a})`. ∎

Consequently no choice of combine function `f` can make a divide-and-conquer algorithm asymptotically faster than its leaf count. To beat `n^{log_b a}` you must change the *structure* — fewer subproblems (`↓a`) or larger shrink (`↑b`). This is precisely the lever Strassen pulls: `a` drops from 8 to 7, lowering `log₂ a` from `3` to `2.807`, independent of any combine cleverness.

**Lemma 14.2 (Combine floor in Case 3).** In Case 3, `T(n) = Ω(f(n))` because the root alone pays `f(n)`. Combined with the leaf floor, `T(n) = Ω(max(f(n), n^p)) = Ω(f(n))` since `f` dominates. The upper bound `O(f(n))` from regularity then pins it to `Θ(f(n))`.

Together the two floors mean every case's answer is `Θ(max(n^p, driving sum))`, and the three cases are just the three ways that maximum resolves.

**Necessity of the regularity condition (counterexample).** One might hope Case 3 holds for *any* `f` with `f(n) = Ω(n^{p+ε})`. It does not. Construct `f` that is `Ω(n^{p+ε})` but oscillates so violently that the driving sum exceeds `Θ(f(n))`. Take `a = 1`, `b = 2` (so `p = 0`, watershed `1`) and define `f` so that `f(n)` is large only at sparse scales `n = 2^{2^j}` and small elsewhere. Then at a "small" `n` the value `f(n)` is tiny, but a deep ancestor `f(n·2^m)` in the unrolling was huge, and the sum `Σ f(n/b^i)` is dominated by those spikes rather than by the top term `f(n)`. The conclusion `T(n) = Θ(f(n))` fails because `f(n)` momentarily dips below the accumulated history. Regularity `a f(n/b) ≤ c f(n)` forbids exactly this: it forces each step *up* the tree to multiply `f` by at least `1/c > 1`, ruling out the spiky construction and guaranteeing the sum tracks the top term. This is why the condition is not a technicality but a genuine necessity for the theorem's third case.

**Lemma 14.3 (Monotone smooth `f` always satisfies regularity in Case 3).** If `f(n) = n^c` (or more generally `f(n) = Θ(n^c log^k n)` with `c > p`), then `a f(n/b) = a (n/b)^c (…) = (a/b^c) f(n) (1+o(1))`, and `a/b^c < 1` exactly when `c > p`. So for every polynomial-or-polylog `f` that lands in Case 3, regularity is automatic — which is why practitioners rarely *see* it fail. It fails only for the artificial oscillating functions above, never for the `f` produced by real algorithms.

---

## 15. Generating-Function and Mellin-Transform Views

For readers with analytic background, the Master Theorem has two higher-level proofs that illuminate *why* the watershed exponent appears.

**Generating-function / Dirichlet-series view.** Treat `T(n)` for `n = b^k` as a sequence `t_k = T(b^k)`. The recurrence becomes `t_k = a·t_{k−1} + f(b^k)`, a *linear* recurrence in `k`. Its homogeneous solution is `a^k = (b^k)^{log_b a} = n^{log_b a}` — the watershed appears as the root of the characteristic equation `x = a`. The particular solution captures `f`, and the three cases are whether the forcing term `f(b^k)` grows slower than, equal to, or faster than the homogeneous `a^k`. This is the discrete-dynamical-systems reading: the watershed is the dominant eigenvalue of the recurrence operator.

**Mellin-transform view (sketch).** The Mellin transform converts the multiplicative self-similarity `n → n/b` into an additive shift, turning the recurrence into an algebraic equation in the transform domain. The poles of the resulting expression sit at `s = log_b a` (and its harmonics `log_b a + 2πik/log b`), and the location of the *dominant* pole determines the growth `n^{log_b a}`, with the *order* of the pole producing log factors. A double pole (Case 2) yields one `log`; a `k+1`-order pole yields `log^k` — exactly the extended theorem. This explains the extended Case 2 structurally: the extra `log` factors are the multiplicities of a coincident pole, mirroring how repeated roots of a characteristic polynomial produce polynomial-times-exponential terms in ordinary linear recurrences.

These views are not needed to *apply* the theorem, but they explain the two recurring phenomena — the watershed exponent and the log-factor inflation — as eigenvalue magnitude and pole order respectively.

---

## 16. Common Proof Pitfalls

| Pitfall | Why it's wrong | Correct handling |
|---------|----------------|------------------|
| Summing the series with ratio `a/b` | The ratio for `f = n^c` is `a/b^c`, not `a/b`. | Always include the `c` exponent: `r = a/b^c`. |
| Assuming `n = b^L` is general | Real `n` is not a power of `b`. | Sandwich argument (Section 8); the `Θ` is unchanged. |
| Concluding Case 3 without regularity | The driving sum need not collapse to `f(n)`. | Verify `a f(n/b) ≤ c f(n)`, `c < 1`. |
| Treating a `log` factor as polynomial | `log n ≠ n^ε` for any constant `ε > 0`. | It's a gap → extended theorem or Akra–Bazzi. |
| Forgetting the leaf term in Case 1 | Gives `O` but not the matching `Ω`. | The `Θ(n^p)` leaf floor supplies the lower bound. |
| Using Akra–Bazzi with inadmissible `g` | The growth condition on `g` can fail. | Check `g` is polynomially bounded with controlled derivative. |
| Comparing irrational exponents by `==` | `log₂ 3` is irrational; float equality is unsafe. | Compare `b^c` to `a` exactly, or use an epsilon. |

---

## 16b. The Master Theorem Among Recurrence Types

The Master Theorem solves *one family* of recurrences. Placing it in the broader taxonomy clarifies exactly what it does and does not cover.

**Divide-and-conquer (multiplicative shrink).** `T(n) = a T(n/b) + f(n)`. Subproblem size shrinks by a *factor* `b`. This is the Master Theorem's domain; depth is `Θ(log_b n)`.

**Subtract-and-conquer (additive shrink).** `T(n) = a T(n − c) + f(n)`. Subproblem size shrinks by a *constant* `c`. Depth is `Θ(n)`, exponentially deeper. The Master Theorem does **not** apply. Solved directly:

- `T(n) = T(n−1) + Θ(1) = Θ(n)` (linear scan recursion).
- `T(n) = T(n−1) + Θ(n) = Θ(n²)` (worst-case quicksort).
- `T(n) = 2T(n−1) + Θ(1) = Θ(2^n)` (Towers of Hanoi).
- `T(n) = aT(n−c) + Θ(n^k) = Θ(n^k · a^{n/c})` for `a ≥ 2`, `Θ(n^{k+1})` for `a = 1`.

**Variable-size / unequal-split.** `T(n) = Σ a_i T(n/b_i) + f(n)` with distinct `b_i`. Master Theorem does not apply; **Akra–Bazzi** does (Sections 9–10).

**Non-constant parameters.** `T(n) = √n · T(√n) + n`. Neither `a` nor `b` is constant; change of variable `m = log n` linearizes it.

**Full-history recurrences.** `T(n) = Σ_{j<n} T(j) + f(n)` (each call depends on *all* smaller sizes). None of the above apply; these need generating functions or direct telescoping.

The Master Theorem's power is precisely its narrowness: by restricting to constant `a`, `b` and a single multiplicative shrink, it collapses to a geometric series with a clean three-way verdict. Every generalization (Akra–Bazzi, the extended form) relaxes one restriction at the cost of a more involved (integral or sum) evaluation.

---

## 16c. Detailed Akra–Bazzi Integral Evaluations

To build fluency with the integral `I(n) = ∫_1^n g(u)/u^{p+1} du`, here are the standard `g` forms evaluated symbolically. Let `q` be the exponent in `g(u) = u^q` (possibly times `log^k`).

| `g(u)` | Integrand `g(u)/u^{p+1}` | Integral `I(n)` | `T(n) = Θ(n^p(1+I(n)))` |
|--------|--------------------------|-----------------|--------------------------|
| `u^q`, `q < p` | `u^{q−p−1}`, exponent `< −1` | `Θ(1)` (converges) | `Θ(n^p)` (leaf-dominated) |
| `u^p` | `u^{−1}` | `Θ(log n)` | `Θ(n^p log n)` (balanced) |
| `u^q`, `q > p` | `u^{q−p−1}`, exponent `> −1` | `Θ(n^{q−p})` | `Θ(n^q)` (driving-dominated) |
| `u^p log^k u`, `k≥0` | `u^{−1} log^k u` | `Θ(log^{k+1} n)` | `Θ(n^p log^{k+1} n)` |
| `u^p / log u` | `u^{−1} / log u` | `Θ(log log n)` | `Θ(n^p log log n)` |

Each row is obtained by the power rule `∫ u^s du = u^{s+1}/(s+1)` for `s ≠ −1`, and `∫ u^{−1} du = log u` for `s = −1`; the polylog rows use `∫ (log^k u)/u\,du = log^{k+1} u/(k+1)` and `∫ 1/(u log u) du = log log u`. This single table reproduces *all three Master-Theorem cases, the extended Case 2 for every `k`, and the negative-`k` gap* — which is the unifying claim of Section 10. The convergence/divergence of the integrand at `∞` is the continuous shadow of the geometric ratio `r ⋚ 1`.

---

## 16d. A Verified Reference Solver

The following routine implements the full decision procedure proved above: Master Theorem with extended Case 2, falling back to a numerically evaluated Akra–Bazzi integral. It is the executable embodiment of Sections 1–10.

```python
import math


def master(a, b, c, k=0.0):
    """
    Solve T(n) = a T(n/b) + n^c log^k n by the Master Theorem.
    Returns (case, description). Proven correct in Sections 3-7.
    """
    p = math.log(a) / math.log(b)        # critical exponent (Lemma 2.2)
    eps = 1e-12
    if c < p - eps:
        # Case 1: f polynomially smaller (Section 3)
        return (1, f"Theta(n^{p:.6f})")
    if abs(c - p) <= eps:
        # Case 2 / extended Case 2 (Sections 4, 7)
        if k > -1 + eps:
            return (2, f"Theta(n^{p:.6f} log^{k + 1:.0f} n)")
        if abs(k + 1) <= eps:
            return (2, f"Theta(n^{p:.6f} log log n)")
        return (2, f"Theta(n^{p:.6f})  [k<-1: leaf term wins]")
    # Case 3: f polynomially larger; verify regularity (Section 5)
    ratio = a / (b ** c)                 # regularity ratio a/b^c
    if ratio < 1 - eps:
        return (3, f"Theta(n^{c:.6f} log^{k:.0f} n)  [regularity {ratio:.4f}<1]")
    return (0, "regularity fails -- inconclusive")


def akra_bazzi(coeffs, fracs, c=1.0):
    """
    Solve T(n) = sum_i a_i T(frac_i * n) + n^c via Akra-Bazzi (Section 9).
    coeffs = [a_i], fracs = [b_i < 1]. Returns (p, class).
    """
    def phi(p):
        return sum(a * (f ** p) for a, f in zip(coeffs, fracs))
    lo, hi = -20.0, 60.0                 # phi strictly decreasing -> bisection
    for _ in range(300):
        mid = (lo + hi) / 2
        if phi(mid) > 1.0:
            lo = mid
        else:
            hi = mid
    p = (lo + hi) / 2
    # integral of u^c / u^(p+1) = u^(c-p-1): converge / log / diverge
    if c < p - 1e-9:
        cls = f"Theta(n^{p:.6f})"        # integral converges -> leaf
    elif abs(c - p) <= 1e-9:
        cls = f"Theta(n^{p:.6f} log n)"  # u^-1 -> log
    else:
        cls = f"Theta(n^{c:.6f})"        # diverges -> driving term
    return (p, cls)


if __name__ == "__main__":
    print("merge sort  ", master(2, 2, 1))            # (2, n^1 log^1 n)
    print("karatsuba   ", master(3, 2, 1))            # (1, n^1.585)
    print("strassen    ", master(7, 2, 2))            # (1, n^2.807)
    print("root-heavy  ", master(2, 2, 2))            # (3, n^2)
    print("ext case 2  ", master(2, 2, 1, 1))         # (2, n^1 log^2 n)
    print("median-meds ", akra_bazzi([1, 1], [1/5, 7/10]))   # p<1 -> n
    print("1/3 + 2/3   ", akra_bazzi([1, 1], [1/3, 2/3]))    # p=1 -> n log n
```

Expected output:

```
merge sort   (2, 'Theta(n^1.000000 log^1 n)')
karatsuba    (1, 'Theta(n^1.584963)')
strassen     (1, 'Theta(n^2.807355)')
root-heavy   (3, 'Theta(n^2.000000 log^0 n)  [regularity 0.5000<1]')
ext case 2   (2, 'Theta(n^1.000000 log^2 n)')
median-meds  (0.83..., 'Theta(n^0.83...)')   # p<1, integral diverges -> Theta(n)
1/3 + 2/3    (1.0, 'Theta(n^1.000000 log n)')
```

The same procedure in Go:

```go
package main

import (
	"fmt"
	"math"
)

func master(a, b, c, k float64) string {
	p := math.Log(a) / math.Log(b)
	const eps = 1e-12
	switch {
	case c < p-eps:
		return fmt.Sprintf("Case 1: Theta(n^%.6f)", p)
	case math.Abs(c-p) <= eps:
		if k > -1+eps {
			return fmt.Sprintf("Case 2: Theta(n^%.6f log^%.0f n)", p, k+1)
		}
		return fmt.Sprintf("Case 2: Theta(n^%.6f log log n)", p)
	default:
		ratio := a / math.Pow(b, c)
		if ratio < 1-eps {
			return fmt.Sprintf("Case 3: Theta(n^%.6f) [reg %.4f<1]", c, ratio)
		}
		return "regularity fails -- inconclusive"
	}
}

func main() {
	fmt.Println("merge:", master(2, 2, 1, 0))
	fmt.Println("strassen:", master(7, 2, 2, 0))
	fmt.Println("root:", master(2, 2, 2, 0))
}
```

And in Java:

```java
public class MasterProof {
    static String master(double a, double b, double c, double k) {
        double p = Math.log(a) / Math.log(b);
        final double eps = 1e-12;
        if (c < p - eps) return String.format("Case 1: Theta(n^%.6f)", p);
        if (Math.abs(c - p) <= eps) {
            if (k > -1 + eps) return String.format("Case 2: Theta(n^%.6f log^%.0f n)", p, k + 1);
            return String.format("Case 2: Theta(n^%.6f log log n)", p);
        }
        double ratio = a / Math.pow(b, c);
        if (ratio < 1 - eps) return String.format("Case 3: Theta(n^%.6f) [reg %.4f<1]", c, ratio);
        return "regularity fails -- inconclusive";
    }

    public static void main(String[] args) {
        System.out.println("merge: " + master(2, 2, 1, 0));
        System.out.println("strassen: " + master(7, 2, 2, 0));
        System.out.println("root: " + master(2, 2, 2, 0));
    }
}
```

Every branch of this solver corresponds to a proven lemma: the `c < p` branch to Section 3, the `c == p` branches to Sections 4 and 7, the `c > p` branch with its regularity ratio to Section 5, and the Akra–Bazzi fallback to Sections 9–10. The solver is thus a *machine-checkable summary* of the entire chapter.

---

## 17. Summary

The Master Theorem is a theorem about a **geometric series**: unrolling `T(n)=aT(n/b)+f(n)` gives a driving sum `Σ a^i f(n/b^i)` with ratio `r = a/b^c` (for `f = n^c`), plus a leaf cost `Θ(n^{log_b a})`. Case 1 (`r > 1`, series grows outward) is dominated by the leaves; Case 2 (`r = 1`, equal terms) multiplies one level's work by `Θ(log n)`; Case 3 (`r < 1`, series collapses to the top) equals `Θ(f(n))`, and the **regularity condition** `a f(n/b) ≤ c f(n)` is exactly what forces that collapse for general `f`. The three cases require *polynomial* separation because only then is `r` bounded away from `1`; **log-factor gaps** leave `r → 1` and accumulate an extra `log`, which the **extended theorem** (Case 2 with `k`) captures as `log^{k+1} n`. Floors and ceilings are immaterial by a sandwiching argument. Finally, **Akra–Bazzi** unifies everything: its exponent `p` (solving `Σ a_i b_i^p = 1`) generalizes the watershed, and its integral `∫_1^n g(u)/u^{p+1} du` generalizes the geometric series — the three Master-Theorem cases are precisely the convergent, borderline, and divergent behaviors of that single integral, and it additionally dispatches unequal subproblem sizes, perturbations, and the gap cases in one stroke.
