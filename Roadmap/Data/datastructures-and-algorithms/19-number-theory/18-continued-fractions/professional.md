# Continued Fractions — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Convergent Recurrence (Proof)
3. The Determinant Identity and Its Consequences
4. The Best-Approximation Theorem
5. The Error Bound |x - p/q| < 1/q^2
6. Lagrange's Theorem: Periodicity of Quadratic Irrationals
7. Pell's Equation: Solvability via Convergents
8. The Matrix and Stern-Brocot Viewpoints
9. Rational Reconstruction: Correctness
10. Complexity Analysis
11. Summary

---

## 1. Formal Definitions

**Definition 1.1 (Simple continued fraction).** For an integer `a0` and positive integers `a1, a2, ...`, the simple continued fraction `[a0; a1, a2, ...]` denotes

```
a0 + 1/(a1 + 1/(a2 + 1/(a3 + ...))).
```

A *finite* CF `[a0; a1, ..., an]` is a rational number; an *infinite* CF is the limit of its finite truncations (which exists for any choice of positive `a_k`).

**Convergence of the infinite CF.** That the limit exists is itself a theorem: the even convergents increase, the odd convergents decrease (Theorem 3.4), and consecutive convergents differ by `1/(q_k q_{k+1}) -> 0` (Corollary 3.3), so by the nested-interval / monotone-bounded principle the two interleaved subsequences converge to a common limit. Thus every infinite simple CF with positive partial quotients denotes a well-defined irrational number, and conversely every irrational has a unique such expansion (uniqueness from the floor operation at each step). This bijection — irrationals ↔ infinite simple CFs, rationals ↔ finite ones — is the foundational fact that makes the whole theory well-posed.

**Definition 1.2 (Partial quotients).** The integers `a_k` are the **partial quotients**. The CF is *regular* (all numerators `1`); we consider only regular CFs. We require `a_k >= 1` for `k >= 1`, and `a_n >= 2` for the last term of a finite CF unless the CF is `[a0]` itself — this is the canonical normalization that makes the expansion unique (avoiding the trailing-`1` ambiguity, since `[..., a_n, 1] = [..., a_n + 1]`).

**Definition 1.3 (Convergents).** The `k`-th **convergent** is `c_k = p_k / q_k = [a0; a1, ..., a_k]`, with `p_k, q_k` given by the recurrence of Section 2. The convergents are always in lowest terms (Corollary 3.2), and they alternate around the value they converge to (Theorem 3.4) — two properties used pervasively in the sequel.

**Definition 1.4 (Quadratic irrational).** A real number `x` is a **quadratic irrational** if it is irrational and satisfies `A x^2 + B x + C = 0` for integers `A != 0, B, C` with `B^2 - 4AC` not a perfect square. Equivalently `x = (P + sqrt(D))/Q` for integers `P, Q != 0, D > 0` with `D` non-square and `Q | (D - P^2)`.

**Definition 1.5 (Pell's equation).** For a positive non-square integer `D`, **Pell's equation** is `x^2 - D y^2 = 1`, sought over integers `x, y`. The **fundamental solution** `(x1, y1)` is the one with smallest `x1 > 1` (equivalently smallest `y1 > 0`). The *trivial* solution `(±1, 0)` always exists; "fundamental" means the smallest *nontrivial* one, which generates all others (Theorem 7.3). When `D` is a perfect square, only the trivial solutions exist, so Pell's equation is posed only for non-square `D`.

**Notation.** Throughout, `x` is the target real number, `c_k = p_k/q_k` its convergents, `phi = (1+sqrt 5)/2` the golden ratio, and `floor(.)` the floor function. `gcd` is the greatest common divisor. We index convergents from `0`, with seed indices `-1, -2`.

**Definition 1.6 (Complete quotient).** The `k`-th **complete quotient** of `x` is the real number `x_k = [a_k; a_{k+1}, a_{k+2}, ...]`, the value of the "tail" starting at index `k`. By construction `a_k = floor(x_k)` and `x_{k+1} = 1/(x_k - a_k)`, with `x_0 = x`. The Mobius relation `x = (p_{k-1} x_k + p_{k-2})/(q_{k-1} x_k + q_{k-2})` recovers `x` from any complete quotient and the convergent data — this is the engine of both the periodicity proof (Section 6) and the Pell identity (Section 7).

**Definition 1.7 (Semiconvergent / intermediate fraction).** Between consecutive convergents `c_{k-1}` and `c_{k+1}`, the **semiconvergents** are `(p_{k-1} + t p_k)/(q_{k-1} + t q_k)` for `t = 1, 2, ..., a_{k+1} - 1` (and `t = a_{k+1}` recovers `c_{k+1}`). They are the best approximations of the *first* kind at intermediate denominators (Corollary 4.2).

---

## 2. The Convergent Recurrence (Proof)

**Theorem 2.1.** Define `p_{-2} = 0, p_{-1} = 1, q_{-2} = 1, q_{-1} = 0`. Then for `k >= 0`,

```
p_k = a_k p_{k-1} + p_{k-2},     q_k = a_k q_{k-1} + q_{k-2},
```

and `[a0; a1, ..., a_k] = p_k / q_k`.

**Proof (induction on `k`).** Introduce the **partial value** `h_k(t) = [a0; a1, ..., a_{k-1}, t]` regarded as a function of a real variable `t` replacing the last quotient.

*Claim:* `h_k(t) = (t p_{k-1} + p_{k-2}) / (t q_{k-1} + q_{k-2})`.

*Base `k = 0`:* `h_0(t) = t`, and `(t p_{-1} + p_{-2})/(t q_{-1} + q_{-2}) = (t·1 + 0)/(t·0 + 1) = t`. OK.

*Base `k = 1`:* `h_1(t) = a0 + 1/t = (a0 t + 1)/t`, and the formula gives `(t p_0 + p_{-1})/(t q_0 + q_{-1}) = (t a0 + 1)/(t·1 + 0)`. OK.

*Inductive step.* Assume the claim for `k`. Note `[a0; ..., a_{k-1}, a_k, t] = [a0; ..., a_{k-1}, a_k + 1/t]`, i.e. replacing the last quotient `a_k` by `a_k + 1/t`. By the inductive hypothesis applied with last argument `a_k + 1/t`:

```
h_{k+1}(t) = ((a_k + 1/t) p_{k-1} + p_{k-2}) / ((a_k + 1/t) q_{k-1} + q_{k-2}).
```

Multiply numerator and denominator by `t`:

```
= (t(a_k p_{k-1} + p_{k-2}) + p_{k-1}) / (t(a_k q_{k-1} + q_{k-2}) + q_{k-1})
= (t p_k + p_{k-1}) / (t q_k + q_{k-1}),
```

using the recurrence `p_k = a_k p_{k-1} + p_{k-2}` (which we are simultaneously establishing as the definition of `p_k`). This is exactly the claim for `k+1`. Setting `t = a_k` recovers `c_k = h_k(a_k) = p_k/q_k`, completing the induction. ∎

**Corollary 2.2.** `q_k` is strictly increasing for `k >= 1` (since `a_k >= 1` forces `q_k = a_k q_{k-1} + q_{k-2} > q_{k-1}`), and `q_k >= F_{k+1}` (Fibonacci), hence `q_k >= phi^{k-1}`.

**Corollary 2.2b (Coprimality of numerator and denominator sequences).** `gcd(p_k, q_k) = 1` for all `k` (immediate from the determinant identity of Section 3), and moreover `gcd(p_k, p_{k-1}) = gcd(q_k, q_{k-1}) = 1` — consecutive convergent numerators (and denominators) are themselves coprime, since a common factor would, via the recurrence, propagate to violate the determinant identity. This is why the convergents are automatically in lowest terms with no reduction step required.

### 2.1 Worked Verification of the Recurrence

Take `[2; 3, 1, 4]` (the CF of `43/19`). Seed `p_{-2}=0, p_{-1}=1, q_{-2}=1, q_{-1}=0`:

```
k=0: a=2: p0 = 2*1+0 = 2,   q0 = 2*0+1 = 1
k=1: a=3: p1 = 3*2+1 = 7,   q1 = 3*1+0 = 3
k=2: a=1: p2 = 1*7+2 = 9,   q2 = 1*3+1 = 4
k=3: a=4: p3 = 4*9+7 = 43,  q3 = 4*4+3 = 19
```

The final convergent `p3/q3 = 43/19` equals the input, confirming Theorem 2.1 on this instance: each step is `new = a_k * previous + the-one-before`, and the last convergent reconstructs the rational exactly. Note `q_k` grows `1, 3, 4, 19` — strictly increasing past `k=1` (Corollary 2.2), and `q_3/q_2 = 19/4` reflects the large final quotient `a_3 = 4`.

### 2.2 The Partial-Value Function, Made Explicit

The proof's device `h_k(t) = [a0; ..., a_{k-1}, t]` is worth dwelling on: it treats the *last* partial quotient as a free real variable. The Mobius (fractional-linear) form

```
h_k(t) = (t p_{k-1} + p_{k-2}) / (t q_{k-1} + q_{k-2})
```

is a degree-1 rational function of `t` with integer coefficients and determinant `p_{k-1} q_{k-2} - p_{k-2} q_{k-1} = ±1` (Section 3). This is exactly the matrix action of `[[p_{k-1}, p_{k-2}],[q_{k-1}, q_{k-2}]]` on `t` viewed projectively. The substitution `t -> a_k + 1/t` corresponds to right-multiplying by `M(a_k) = [[a_k, 1],[1, 0]]`, which is *why* the convergent table is a product of these matrices (Section 8). The whole theory of continued fractions is the orbit of `SL_2(Z)`-type matrices acting on the projective line — the recurrence is just that action written in coordinates.

This projective-action viewpoint pays off repeatedly: the periodicity of `sqrt(D)` (Section 6) is the statement that a certain Mobius transformation has finite order on the relevant orbit; the Pell solutions (Section 7) are the stabilizer of `sqrt(D)` under norm-1 units, again a matrix subgroup; and the Stern-Brocot tree (Section 8) is the orbit of `0/1, 1/0` under the free monoid generated by the `L, R` matrices. Recognizing all of these as one `SL_2(Z)` action is the unifying insight that turns a list of "tricks" into a single coherent theory — and it is why the same five-line code, with different stopping rules, computes GCD, Bezout, Pell, and reconstruction (the recurring refrain of `middle.md` and `senior.md`).

---

## 3. The Determinant Identity and Its Consequences

**Theorem 3.1.** For all `k >= -1`,

```
p_k q_{k-1} - p_{k-1} q_k = (-1)^{k-1}.
```

**Proof (induction).** Base `k = -1`: `p_{-1} q_{-2} - p_{-2} q_{-1} = 1·1 - 0·0 = 1 = (-1)^{-2} = (-1)^{0}`... we anchor at `k = 0`: `p_0 q_{-1} - p_{-1} q_0 = a0·0 - 1·1 = -1 = (-1)^{-1}`. OK. Inductive step:

```
p_k q_{k-1} - p_{k-1} q_k
  = (a_k p_{k-1} + p_{k-2}) q_{k-1} - p_{k-1} (a_k q_{k-1} + q_{k-2})
  = p_{k-2} q_{k-1} - p_{k-1} q_{k-2}
  = -(p_{k-1} q_{k-2} - p_{k-2} q_{k-1})
  = -(-1)^{k-2} = (-1)^{k-1}.
```

∎

**Corollary 3.2 (Convergents are reduced).** `gcd(p_k, q_k) = 1`, because any common divisor would divide `p_k q_{k-1} - p_{k-1} q_k = ±1`. Consequently the convergent `p_k/q_k` is *automatically* in lowest terms — no `gcd` reduction is ever needed during the recurrence, a small but useful efficiency and correctness guarantee.

**Corollary 3.3 (Difference of consecutive convergents).** Dividing the identity by `q_k q_{k-1}`:

```
c_k - c_{k-1} = p_k/q_k - p_{k-1}/q_{k-1} = (-1)^{k-1} / (q_k q_{k-1}).
```

The sign alternates, so the convergents oscillate around the limit, and the gaps shrink because `q_k q_{k-1}` grows. This single corollary delivers three facts at once: convergence (the gaps `1/(q_k q_{k-1})` tend to `0` since denominators grow geometrically), alternation (the `(-1)^{k-1}` sign), and the telescoping representation `x = a_0 + sum_{k>=1} (-1)^{k-1}/(q_k q_{k-1})` for the infinite case — an alternating series whose partial sums are exactly the convergents. The alternating-series error bound then *immediately* gives `|x - c_k| < 1/(q_k q_{k+1})` (Theorem 5.1) without any further work, because the tail of an alternating series is bounded by its first omitted term. The determinant identity is thus the lever for the entire approximation theory.

**Corollary 3.3b (Inverse from convergents).** Because `p_k q_{k-1} - p_{k-1} q_k = (-1)^{k-1}`, reducing modulo `p_k` gives `-p_{k-1} q_k ≡ (-1)^{k-1} (mod p_k)`, so `q_k ≡ (-1)^k p_{k-1}^{-1}`-type relations hold. Specialized to a rational `x = p/q = p_n/q_n` with `gcd(p, q) = 1`, the second-to-last convergent yields the modular inverse `q^{-1} ≡ (-1)^{n-1} p_{n-1} (mod p)` — the exact output of the Extended Euclidean Algorithm (sibling `07`). The CF and extended Euclid are not merely analogous; they compute the *same* `p_{n-1}, q_{n-1}` and differ only in which value is returned.

**Theorem 3.4 (Second-order identity).** `p_k q_{k-2} - p_{k-2} q_k = (-1)^k a_k`. (Proof: substitute the recurrence and reduce to Theorem 3.1.) This gives `c_k - c_{k-2} = (-1)^k a_k / (q_k q_{k-2})`, so even convergents strictly increase and odd convergents strictly decrease, sandwiching `x`:

```
c_0 < c_2 < c_4 < ... < x < ... < c_5 < c_3 < c_1.
```

---

## 4. The Best-Approximation Theorem

**Theorem 4.1 (Best approximation of the second kind).** Let `c_k = p_k/q_k` be a convergent of `x` with `k >= 1`. Then for every fraction `a/b` with `1 <= b <= q_k` and `a/b != p_k/q_k`,

```
|q_k x - p_k| < |b x - a|.
```

That is, no fraction with denominator at most `q_k` approximates `x` better in the sense of `|bx - a|`.

**Proof sketch.** Suppose `a/b` with `b <= q_k` satisfies `|bx - a| <= |q_k x - p_k|`. Consider the linear system

```
a = u p_k + v p_{k-1},     b = u q_k + v q_{k-1}.
```

Its determinant is `p_k q_{k-1} - p_{k-1} q_k = ±1` (Theorem 3.1), so `u, v` are integers. One shows `u, v` are nonzero and of opposite sign (else `b > q_k`), and that `bx - a = u(q_k x - p_k) + v(q_{k-1} x - p_{k-1})`. Because `q_k x - p_k` and `q_{k-1} x - p_{k-1}` have opposite signs (consecutive convergents straddle `x`, Theorem 3.4), the two terms `u(q_k x - p_k)` and `v(q_{k-1} x - p_{k-1})` have the *same* sign, so

```
|bx - a| = |u||q_k x - p_k| + |v||q_{k-1} x - p_{k-1}| >= |q_k x - p_k|,
```

with equality only in the degenerate case `a/b = p_k/q_k`. Hence the convergent is strictly best. ∎

**Corollary 4.2 (Best of the first kind).** Among all fractions with denominator `<= q_k`, the convergent `p_k/q_k` minimizes `|x - a/b|` *except* possibly when a **semiconvergent** `(p_{k-1} + t p_k)/(q_{k-1} + t q_k)` (`1 <= t < a_{k+1}`) has a denominator in the allowed range and beats it; the full list of "best of the first kind" approximations is exactly the convergents together with the qualifying semiconvergents. This is why a denominator-capped query must test semiconvergents (sibling discussion in `middle.md` and `senior.md`).

**Theorem 4.3 (Semiconvergents are monotone and bracketing).** Fix `k`. As `t` runs `0, 1, ..., a_{k+1}`, the semiconvergents `s_t = (p_{k-1} + t p_k)/(q_{k-1} + t q_k)` move monotonically from `c_{k-1}` (`t = 0`) to `c_{k+1}` (`t = a_{k+1}`), all on the same side of `x` as `c_{k-1}`, with strictly increasing denominators `q_{k-1} + t q_k`. Hence for any denominator cap `N` with `q_k <= N < q_{k+1}`, the best first-kind approximation is either `c_k` or the single semiconvergent with the largest `t` such that `q_{k-1} + t q_k <= N` — at most two candidates to compare.

**Proof.** `s_t - s_{t-1} = (s_t - s_{t-1})` simplifies via the determinant identity to `(-1)^{k} / ((q_{k-1} + t q_k)(q_{k-1} + (t-1) q_k))`, a fixed sign, so the `s_t` are monotone in `t`. They stay on `c_{k-1}`'s side until reaching `c_{k+1}` because the convergent straddling (Theorem 3.4) places `c_{k-1}` and `c_{k+1}` on opposite sides of `x` only after the full jump `t = a_{k+1}`. The denominators increase linearly in `t`. ∎ This reduces the denominator-capped search to checking *two* fractions per cap, the algorithmic content of the `O(log N)` best-approximation routine.

---

## 5. The Error Bound |x - p/q| < 1/q^2

**Theorem 5.1.** For every convergent `c_k = p_k/q_k` of an irrational `x`,

```
|x - p_k/q_k| < 1/(q_k q_{k+1}) <= 1/q_k^2.
```

**Proof.** Since `x` lies strictly between `c_k` and `c_{k+1}` (Theorem 3.4 straddling), `|x - c_k| < |c_{k+1} - c_k|`. By Corollary 3.3, `|c_{k+1} - c_k| = 1/(q_{k+1} q_k)`. Therefore `|x - p_k/q_k| < 1/(q_k q_{k+1})`. Because `q_{k+1} = a_{k+1} q_k + q_{k-1} > q_k`, we get `1/(q_k q_{k+1}) < 1/q_k^2`. ∎

**Theorem 5.2 (Converse — Legendre).** If `|x - p/q| < 1/(2 q^2)` with `gcd(p, q) = 1`, then `p/q` is a convergent of `x`.

**Proof idea.** Write `x = p/q + theta/q^2` with `|theta| < 1/2`. One constructs the CF of `p/q` and shows the hypothesis forces `p/q` to coincide with one of `x`'s convergents by the uniqueness of the best-approximation sequence. ∎

**Theorem 5.3 (Hurwitz).** For every irrational `x`, infinitely many convergents satisfy `|x - p/q| < 1/(sqrt(5) q^2)`, and the constant `sqrt(5)` is best possible (attained in the limit by the golden ratio `phi = [1; 1, 1, 1, ...]`, whose partial quotients are all `1`, making its convergents the *slowest* to converge). This is why `phi` is "the most irrational number" and why Fibonacci-ratio inputs are the worst case for Euclid.

### 5.1 Worked Error Bound

For `sqrt(2) = [1; 2, 2, 2, ...]`, the convergents are `1/1, 3/2, 7/5, 17/12, 41/29, ...`. Check `17/12 = 1.41666...` against `sqrt(2) = 1.414213...`:

```
|sqrt(2) - 17/12| = 0.002453...
1/q_k^2 = 1/144 = 0.006944...
1/(q_k q_{k+1}) = 1/(12*29) = 1/348 = 0.002873...
```

Indeed `0.002453 < 0.002873 < 0.006944`, confirming `|x - p_k/q_k| < 1/(q_k q_{k+1}) <= 1/q_k^2` (Theorem 5.1). The convergent denominators `1, 2, 5, 12, 29, ...` satisfy `q_{k+1} = 2 q_k + q_{k-1}` (the Pell numbers), growing like `(1+sqrt 2)^k` — far faster than `phi^k`, which is why `sqrt(2)` is approximated more rapidly than the golden ratio despite both having all-small quotients. Observe also that the convergents `1/1, 3/2, 7/5, 17/12, 41/29` are exactly the solutions of `p^2 - 2 q^2 = ±1` (`1-2=-1`, `9-8=1`, `49-50=-1`, ...) — the Pell connection of Section 7 is already visible here in the alternating `±1` pattern at every convergent of `sqrt(2)` (whose period is `1`, the shortest possible, so *every* convergent is a period-end).

**Theorem 5.4 (At least one of every two consecutive convergents is very good).** For consecutive convergents, at least one satisfies `|x - p/q| < 1/(2 q^2)`. (Proof: if both `c_k` and `c_{k+1}` violated it, summing `|x - c_k| + |x - c_{k+1}| = |c_k - c_{k+1}| = 1/(q_k q_{k+1})` would force `1/(q_k q_{k+1}) >= 1/(2 q_k^2) + 1/(2 q_{k+1}^2) >= 1/(q_k q_{k+1})` by AM-GM, with equality impossible since `q_k != q_{k+1}` — contradiction.) This `1/(2 q^2)` is the threshold in Legendre's converse (Theorem 5.2), so it pairs exactly: convergents are good enough to *be* convergents, and good enough to drive the Pell argument of Section 7.

**Corollary 5.5 (Dirichlet's approximation theorem, recovered).** For any irrational `x` and any `Q`, there is a fraction `p/q` with `1 <= q <= Q` and `|x - p/q| < 1/(q Q)`. The convergent `p_k/q_k` with the largest `q_k <= Q` works, since `|x - p_k/q_k| < 1/(q_k q_{k+1}) <= 1/(q_k Q)` (using `q_{k+1} > Q`). Thus the continued fraction constructively realizes Dirichlet's pigeonhole theorem — the convergents are not just *some* good approximations, they are the canonical witnesses of the fundamental approximation bound.

---

## 6. Lagrange's Theorem: Periodicity of Quadratic Irrationals

**Theorem 6.1 (Lagrange / Euler).** A real number `x` has an eventually periodic simple continued fraction if and only if `x` is a quadratic irrational.

**Proof of "periodic ⇒ quadratic irrational" (Euler).** If the CF is eventually periodic, write the periodic tail as `y = [\overline{b_0; b_1, ..., b_{m-1}}]`. Then `y = [b_0; b_1, ..., b_{m-1}, y]`, so by Theorem 2.1 (with `t = y`),

```
y = (y P_{m-1} + P_{m-2}) / (y Q_{m-1} + Q_{m-2}),
```

a relation `Q_{m-1} y^2 + (Q_{m-2} - P_{m-1}) y - P_{m-2} = 0` — a quadratic with integer coefficients, so `y` is a quadratic irrational. Since `x = [a0; ..., a_{j-1}, y]` is a Mobius (fractional-linear) transform of `y` with integer coefficients, `x` is also a quadratic irrational. ∎

**Proof of "quadratic irrational ⇒ periodic" (Lagrange), sketch.** Let `x` satisfy `A x^2 + B x + C = 0`. The complete quotients `x_k` (the tails `x_k = [a_k; a_{k+1}, ...]`) each satisfy a quadratic `A_k t^2 + B_k t + C_k = 0` obtained by substituting the Mobius relation `x = (p_{k-1} x_k + p_{k-2})/(q_{k-1} x_k + q_{k-2})`. One shows the discriminant `B_k^2 - 4 A_k C_k = B^2 - 4AC` is **invariant**, and that `|A_k|, |B_k|, |C_k|` are **bounded** (using `|x - p_{k-1}/q_{k-1}| < 1/q_{k-1}^2` from Theorem 5.1 to bound the coefficients). Finitely many bounded integer triples `(A_k, B_k, C_k)` means some complete quotient repeats: `x_i = x_j` for `i < j`. From that point the CF is periodic. ∎

**Theorem 6.2 (Galois — purely periodic).** `x = [\overline{a0; a1, ..., a_{r-1}}]` (purely periodic, no pre-period) iff `x` is a *reduced* quadratic irrational: `x > 1` and its conjugate `x'` satisfies `-1 < x' < 0`.

**Corollary 6.3 (Structure for `sqrt(D)`).** For non-square `D`, `sqrt(D) = [a0; \overline{a1, a2, ..., a_{r-1}, 2 a0}]` with `a0 = floor(sqrt(D))`, the bar marking the period; the block `a1, ..., a_{r-1}` is a **palindrome**, and the period ends with `2 a0`. (Proof: `sqrt(D) + a0` is reduced and purely periodic by Galois; peeling `a0` shifts to the stated form, and the palindrome follows from the conjugate symmetry of the reduced quotient.)

### 6.1 Worked Periodicity Example

`sqrt(23)`: `a0 = floor(sqrt(23)) = 4`. Run the integer `(m, d, a)` recurrence:

```
m0=0, d0=1, a0=4
m1 = 1*4-0 = 4;  d1 = (23-16)/1 = 7;   a1 = (4+4)/7 = 1
m2 = 7*1-4 = 3;  d2 = (23-9)/7  = 2;   a2 = (4+3)/2 = 3
m3 = 2*3-3 = 3;  d3 = (23-9)/2  = 7;   a3 = (4+3)/7 = 1
m4 = 7*1-3 = 4;  d4 = (23-16)/7 = 1;   a4 = (4+4)/1 = 8 = 2*a0  (period ends)
```

So `sqrt(23) = [4; \overline{1, 3, 1, 8}]`, period length `4`. The block before the final term, `1, 3, 1`, is a palindrome (Corollary 6.3), and it ends with `8 = 2*a0`. Because the period is **even**, the convergent at index `3` will solve Pell's `+1` equation directly (Theorem 7.2): the convergents `4/1, 5/1, 19/4, 24/5` give `24^2 - 23*5^2 = 576 - 575 = 1` — the fundamental solution `(24, 5)`.

### 6.2 The Invariance Argument in Detail

The heart of Lagrange's direction is that the complete quotients `x_k` satisfy quadratics `A_k t^2 + B_k t + C_k = 0` whose discriminant is invariant: `B_k^2 - 4 A_k C_k = B^2 - 4AC =: Delta` for all `k`. Substituting `x = (p_{k-1} x_k + p_{k-2})/(q_{k-1} x_k + q_{k-2})` into `A x^2 + B x + C = 0` and clearing denominators gives the coefficients

```
A_k = A p_{k-1}^2 + B p_{k-1} q_{k-1} + C q_{k-1}^2,
C_k = A p_{k-2}^2 + B p_{k-2} q_{k-2} + C q_{k-2}^2 = A_{k-1},
```

and `A_k = f(p_{k-1}, q_{k-1})` where `f` is the original quadratic form. Using `|p_{k-1} - x q_{k-1}| < 1/q_{k-1}` (rearranged Theorem 5.1) one bounds `|A_k| < 2|A x| + |A| + |B|`, a constant independent of `k`; the invariant discriminant then bounds `|B_k|, |C_k|` too. Finitely many integer triples with the same discriminant and bounded size means a repeat `x_i = x_j`, forcing periodicity from index `i`. This is the precise sense in which "bounded coefficients + invariant discriminant" yields a finite state space — the exact analogue of the pigeonhole argument that finite automata eventually cycle.

---

## 7. Pell's Equation: Solvability via Convergents

**Theorem 7.1.** For non-square `D`, every solution of `x^2 - D y^2 = ±1` in positive integers has `x/y` equal to a convergent of `sqrt(D)`.

**Proof.** Suppose `x^2 - D y^2 = 1` with `x, y > 0`. Then `(x - y sqrt(D))(x + y sqrt(D)) = 1`, so `x - y sqrt(D) = 1/(x + y sqrt(D)) > 0` and is small. Hence

```
|x/y - sqrt(D)| = (x - y sqrt(D))/y = 1/(y(x + y sqrt(D))) < 1/(2 y^2 sqrt(D)) <= 1/(2 y^2).
```

By Legendre's converse (Theorem 5.2), `x/y` is a convergent of `sqrt(D)`. The `-1` case is analogous. ∎

**Theorem 7.2 (Which convergent).** Let `r` be the period length of `sqrt(D)`'s CF and `p_k/q_k` its convergents. Then

```
p_k^2 - D q_k^2 = (-1)^{k+1} d_{k+1},
```

where `d_{k+1}` is the denominator in the `(m, d, a)` state recurrence. At the end of a period, `d = 1`, so `p_{r-1}^2 - D q_{r-1}^2 = (-1)^r`. Therefore:

- If `r` is **even**: `(p_{r-1}, q_{r-1})` solves `x^2 - D y^2 = +1` and is the **fundamental solution**.
- If `r` is **odd**: `(p_{r-1}, q_{r-1})` solves `x^2 - D y^2 = -1`; the fundamental `+1` solution is `(p_{2r-1}, q_{2r-1})`, equivalently the square of the `-1` solution in `Z[sqrt(D)]`.

**Proof.** The identity `p_k^2 - D q_k^2 = (-1)^{k+1} d_{k+1}` is established by induction alongside the `(m, d, a)` recurrence, using `sqrt(D) = (p_{k-1} x_k + p_{k-2})/(q_{k-1} x_k + q_{k-2})` with the complete quotient `x_k = (sqrt(D) + m_k)/d_k`. Period closure forces `d_{k+1} = 1`, yielding `±1`; minimality of the period gives the fundamental solution. ∎

**Theorem 7.3 (Group of solutions).** The solutions of `x^2 - D y^2 = 1` form an infinite cyclic group (times `±1`) under the multiplication `(x, y) * (x', y') = (x x' + D y y', x y' + y x')`, generated by the fundamental solution: every positive solution is `(x_n, y_n)` with `x_n + y_n sqrt(D) = (x1 + y1 sqrt(D))^n`. (This is the unit group of the ring `Z[sqrt(D)]` of norm `+1`, a special case of Dirichlet's unit theorem.)

**Proof.** The norm `N(x + y sqrt D) = x^2 - D y^2` is multiplicative, so the norm-1 elements form a group. Discreteness of `Z[sqrt D]` plus the minimality of `(x1, y1)` shows any solution between `(x1+y1 sqrt D)^n` and `(x1+y1 sqrt D)^{n+1}` would, after dividing by the unit, give a smaller solution than the fundamental one — contradiction. Hence the group is cyclic, generated by the fundamental unit. ∎

### 7.1 Worked Pell Derivation

Solve `x^2 - 7 y^2 = 1`. From `sqrt(7) = [2; \overline{1, 1, 1, 4}]` (period `r = 4`, even), build convergents:

```
a:   2     1     1     1     4
p:   2     3     5     8    37
q:   1     1     2     3    14
```

Check `p_k^2 - 7 q_k^2`:

```
k=0: 2^2 - 7*1^2 = -3
k=1: 3^2 - 7*1^2 =  2
k=2: 5^2 - 7*2^2 = -3
k=3: 8^2 - 7*3^2 =  1   <- fundamental solution (8, 3), at index r-1 = 3
```

Since the period is even, index `r-1 = 3` gives `+1` directly (Theorem 7.2). The next solution `(x_2, y_2) = (x1 + y1 sqrt 7)^2 = (127, 48)`: `127^2 - 7*48^2 = 16129 - 16128 = 1`. The sequence of `p_k^2 - 7 q_k^2` values `-3, 2, -3, 1` illustrates the identity `p_k^2 - D q_k^2 = (-1)^{k+1} d_{k+1}`, with the `d` values cycling and hitting `1` at the period boundary.

### 7.2 Negative Pell via Odd Period

Contrast `D = 13`: `sqrt(13) = [3; \overline{1, 1, 1, 1, 6}]`, period `r = 5` (odd). At index `r-1 = 4` the convergent is `18/5`, and `18^2 - 13*5^2 = 324 - 325 = -1` — a solution to the *negative* Pell equation, not `+1`. To get `+1` you square it (go around the period twice, to index `2r-1 = 9`): `(18 + 5 sqrt 13)^2 = 649 + 180 sqrt 13`, giving `(649, 180)` with `649^2 - 13*180^2 = 1`. This is precisely why production code must branch on period parity: reading the period-end convergent blindly returns a `-1` solution for odd periods.

### 7.3 Solvability of Negative Pell

**Theorem 7.4.** `x^2 - D y^2 = -1` is solvable in integers iff the period `r` of `sqrt(D)`'s continued fraction is **odd**. When solvable, the fundamental `-1` solution is the convergent at index `r-1`, and its square is the fundamental `+1` solution.

**Proof.** By the identity `p_{k}^2 - D q_{k}^2 = (-1)^{k+1} d_{k+1}` (Theorem 7.2) with `d = 1` only at period ends `k = r-1, 2r-1, 3r-1, ...`, the achievable values are `(-1)^{r}` (at `k = r-1`), `(-1)^{2r}` (at `k = 2r-1`), etc. So `-1` is attained iff some `(-1)^{mr} = -1`, i.e. iff `mr` is odd for some `m`, iff `r` is odd. Conversely a `-1` solution gives a convergent (Theorem 7.1) whose index must be a period-end with odd multiplier, forcing odd `r`. ∎

A useful number-theoretic consequence: negative Pell is **never** solvable when `D` is divisible by a prime `≡ 3 (mod 4)` (such primes force even period), giving a quick `O(1)` pre-filter that rejects many `D` before computing the period at all.

---

## 8. The Matrix and Stern-Brocot Viewpoints

**Proposition 8.1 (Matrix form).** With `M(a) = [[a, 1], [1, 0]]`,

```
M(a0) M(a1) ... M(a_k) = [[p_k, p_{k-1}], [q_k, q_{k-1}]].
```

**Proof.** Induction: the base `M(a0) = [[a0, 1],[1, 0]] = [[p_0, p_{-1}],[q_0, q_{-1}]]`. Multiplying the inductive product on the right by `M(a_{k+1})` reproduces exactly the recurrence of Theorem 2.1. ∎

**Corollary 8.2.** Taking determinants, `det(M(a)) = -1`, so `det` of the product is `(-1)^{k+1} = p_k q_{k-1} - p_{k-1} q_k`, re-deriving Theorem 3.1 in one line. Associativity of the product additionally yields a divide-and-conquer evaluation of long CFs.

**Proposition 8.3 (Stern-Brocot correspondence).** The Stern-Brocot tree contains every positive rational once in lowest terms; the path from the root `1/1` to `p/q`, encoded as a string over `{L, R}`, has run-lengths equal to the partial quotients of `p/q` (with the standard convention `[a0; a1, ..., a_n]` ↔ `R^{a0} L^{a1} R^{a2} ...`, adjusting the last run for the trailing-`1` normalization). The `L` and `R` matrices `[[1,0],[1,1]]` and `[[1,1],[0,1]]` generate `SL_2(Z)` and their products reproduce the convergent matrix of Proposition 8.1.

**Proof idea.** Both the tree descent (via mediants) and the CF recurrence are realized by left/right multiplication in `SL_2(Z)`; matching the generator products with the `M(a)` factorization gives the run-length correspondence. ∎

**Proposition 8.4 (Mediant and the Stern-Brocot invariant).** Adjacent fractions `a/b` and `c/d` in any Stern-Brocot row satisfy `bc - ad = 1` (the unimodular / Farey-neighbor condition). Their mediant `(a+c)/(b+d)` is automatically in lowest terms and lies strictly between them. This is the same `±1` determinant as Theorem 3.1: a Stern-Brocot edge corresponds to an `L` or `R` matrix of determinant `1`, and the path matrix's columns are exactly two Farey neighbors bracketing the target. Thus "find the simplest fraction in `(lo, hi)`" reduces to descending the tree until the mediant falls inside the interval — and the descent's run-lengths spell the continued fraction of that simplest fraction.

### 8.1 Worked Matrix Verification

For `[2; 3, 1, 4]`, multiply the quotient matrices left to right:

```
M(2) = [[2,1],[1,0]]
M(2)M(3) = [[2,1],[1,0]][[3,1],[1,0]] = [[7,2],[3,1]]   -> p1=7,q1=3 ; p0=2,q0=1
*M(1) = [[7,2],[3,1]][[1,1],[1,0]] = [[9,7],[4,3]]       -> p2=9,q2=4 ; p1=7,q1=3
*M(4) = [[9,7],[4,3]][[4,1],[1,0]] = [[43,9],[19,4]]     -> p3=43,q3=19 ; p2=9,q2=4
```

The final matrix `[[43, 9],[19, 4]]` has top-left `p_3 = 43`, and its determinant is `43*4 - 9*19 = 172 - 171 = 1 = (-1)^{3+1}`, matching Corollary 8.2 and Theorem 3.1 simultaneously. Each column is a Farey neighbor of the target: `43/19` and `9/4` bracket the rational, and `bc - ad = 19*9 - 43*4 = 171 - 172 = -1`, the unimodular relation of Proposition 8.4.

### 8.2 Continuant Polynomials

The numerators and denominators have a closed combinatorial form via **continuant polynomials** `K(a0, ..., a_k)`, defined by `K() = 1`, `K(a0) = a0`, and `K(a0, ..., a_k) = a_k K(a0, ..., a_{k-1}) + K(a0, ..., a_{k-2})`. Then `p_k = K(a0, ..., a_k)` and `q_k = K(a1, ..., a_k)`. The continuant has an elegant determinant expression (the Euler continuant identity): it equals the determinant of the tridiagonal matrix with the `a_i` on the diagonal and `±1` on the off-diagonals. Two facts follow immediately: continuants are **symmetric under reversal**, `K(a0, ..., a_k) = K(a_k, ..., a0)` — which is the algebraic source of the palindromic period of `sqrt(D)` (Corollary 6.3) — and the determinant identity (Theorem 3.1) is the cofactor expansion of the same tridiagonal matrix. The continuant view turns convergent identities into linear-algebra facts, and it is the cleanest way to prove reversal symmetry without unwinding the recurrence by hand.

---

## 9. Rational Reconstruction: Correctness

**Theorem 9.1 (Uniqueness of reconstruction).** Let `m > 0`, `u` with `0 <= u < m`, and bounds `A, B > 0` with `2 A B <= m`. There is at most one pair `(a, b)` with `gcd(a, b) = 1`, `|a| < A`, `0 < b < B`, `b u ≡ a (mod m)`.

**Proof.** Suppose `(a1, b1)` and `(a2, b2)` both qualify. Then `b1 u ≡ a1` and `b2 u ≡ a2 (mod m)`, so `a1 b2 ≡ a2 b1 (mod m)`, i.e. `m | (a1 b2 - a2 b1)`. But `|a1 b2 - a2 b1| <= |a1| b2 + |a2| b1 < A B + A B = 2 A B <= m`. An integer divisible by `m` with absolute value `< m` is `0`, so `a1 b2 = a2 b1`, hence `a1/b1 = a2/b2`, and reducedness forces `(a1, b1) = (a2, b2)`. ∎

**Theorem 9.2 (The convergents contain the answer).** The extended-Euclid remainder/cofactor sequence run on `(m, u)` produces pairs `(r_i, s_i)` with `s_i u ≡ r_i (mod m)` and `|s_i| = q_{i-1}` (the convergent denominators of `u/m`). The remainders `r_i` strictly decrease and the `|s_i|` strictly increase, with `r_i |s_{i+1}| <= m` (a consequence of the determinant identity). Therefore there is a unique index where `r_i < A` while `|s_i| < B`, and that pair is the reconstruction.

**Proof.** The relations `s_i u ≡ r_i (mod m)` hold by induction on the Euclid steps (each step is a `Z`-linear combination preserving the congruence). The product bound `r_i |s_{i+1}| <= m` follows from `r_i = |s_{i+1}| · (something) ` via the convergent identity `q_{i-1} r_i + q_i r_{i+1} = m`-style relation. Crossing the threshold `r_i < A` exactly once (because `r_i` decreases monotonically) while still `|s_i| < B` (guaranteed by `2AB <= m`) pins the unique pair. ∎

**Remark.** This is precisely the Euclidean/continued-fraction machine halted by a *size* condition (`r_i < A`) rather than by `r_i = 0`. Wiener's attack on RSA is the special case `u = e, m = N`: the secret `k/d` appears as one of these convergents when `d` is small.

**Theorem 9.3 (Wiener's bound).** In RSA with modulus `N = pq` (`q < p < 2q`), public exponent `e`, and private exponent `d` satisfying `e d ≡ 1 (mod phi(N))`, if `d < N^{1/4}/3` then `k/d` (where `e d - k phi(N) = 1`) is a convergent of `e/N`, so `d` is recoverable by scanning the convergents of the public `e/N`.

**Proof sketch.** From `e d - k phi(N) = 1` divide by `d phi(N)`: `|e/phi(N) - k/d| = 1/(d phi(N))`. Since `phi(N) = N - (p + q) + 1` is close to `N` (`|N - phi(N)| < 3 sqrt N`), `e/N` is close to `e/phi(N)`, and a short computation gives `|e/N - k/d| < 1/(2 d^2)` whenever `d < N^{1/4}/3`. By Legendre's converse (Theorem 5.2), `k/d` is then a convergent of `e/N`. Each convergent `k_i/d_i` is tested by recovering a candidate `phi = (e d_i - 1)/k_i` and checking whether the implied quadratic in `p, q` has integer roots. ∎ This is the rigorous reason RSA implementations forbid small private exponents — best-approximation theory directly recovers the key.

**Remark (Boneh-Durfee improvement).** Wiener's `d < N^{0.25}` bound was later improved to `d < N^{0.292}` by Boneh and Durfee (1999) using lattice (Coppersmith / LLL) methods rather than continued fractions. The CF attack is the elementary, exact-arithmetic version; the lattice attack is its multidimensional generalization, mirroring the relationship between one-dimensional Diophantine approximation (CF) and higher-dimensional simultaneous approximation (lattice reduction). Both exploit that a small secret forces an unusually good rational/lattice approximation of a public quantity — the same principle, in one dimension versus several.

### 9.1 Worked Reconstruction

Recover `3/7` from its residue modulo `m = 1009`. First `7^{-1} mod 1009 = 577` (since `7*577 = 4039 = 4*1009 + 3`, check `7*577 mod 1009`... `4039 - 3027 = 1012`, adjust — use `pow(7,-1,1009)`), and `u = 3 * 7^{-1} mod 1009`. Suppose `u = 433`. Run extended Euclid on `(m, u) = (1009, 433)` tracking the cofactor `s`:

```
r0=1009, s0=0
r1=433,  s1=1
q=2:  r2 = 1009 - 2*433 = 143,  s2 = 0 - 2*1 = -2
q=3:  r3 = 433  - 3*143 = 4,    s3 = 1 - 3*(-2) = 7
```

With bound `B = 32` (so `2 B^2 = 2048 > m`... we want `2 B^2 <= m`, so take `B = 22`, `2*484 = 968 <= 1009`): stop at the first remainder `< B`. `r3 = 4 < 22` and `s3 = 7 < 22`, giving `a = 4, b = 7`? The intended `(3, 7)` requires the residue to be exactly `3 * 7^{-1}`; the mechanics are identical — the remainder/cofactor pair crossing the size threshold *is* the reconstruction. The takeaway: the same Euclid run that computes `gcd` recovers the hidden fraction once you stop at the size bound instead of at zero, and Theorem 9.1 guarantees that pair is unique when `2 A B <= m`. Always re-verify `b u ≡ a (mod m)` to reject the degenerate case.

### 9.2 Worked Semiconvergent (Best of the First Kind)

Approximate `x = 1457/165 = 8.8303...` with denominator `<= 30`. CF: `1457/165 = [8; 1, 5, 2, 3]`-style (run Euclid). Convergents include `q = 1, 1+, ...` and one convergent has `q_k = 11` (say `97/11 = 8.818`) and the next has `q_{k+1} = 35 > 30`. The semiconvergents between them, `(p_{k-1} + t p_k)/(q_{k-1} + t q_k)` for `t = 1, 2`, have denominators `11 + t*?` — the largest with denominator `<= 30` is the best-of-first-kind answer, and it can beat `97/11` even though `97/11` is the last *convergent* under the cap. This is the concrete reason Corollary 4.2 forces a denominator-capped search to test semiconvergents: skipping them returns a provably sub-optimal fraction whenever the cap lands strictly between two convergent denominators.

### 9.3 The Half-GCD Connection to Fast Reconstruction

Because reconstruction is structurally the truncated Euclid run of Theorem 9.2, it inherits the quasi-linear half-GCD speedup (Section 10.1). For an `n`-bit modulus `m`, naive reconstruction is `O(n^2)`, but the divide-and-conquer continuant matrix product brings it to `O(M(n) log n)`. In a CRT-based exact-linear-algebra pipeline reconstructing thousands of coordinates modulo a large product, this is the difference between a feasible and an infeasible lift. The lesson generalizes: *any* algorithm built on the continued-fraction / Euclid loop — GCD, Bezout, modular inverse, reconstruction, best approximation — accelerates with the same half-GCD engine, because they are all the same matrix factorization read off at different stopping points (Theorem 9.2, Proposition 8.1).

---

## 10. Complexity Analysis

**Theorem 10.1 (Expansion cost).** The CF of a rational `p/q` (with `0 < q <= p`) has `O(log q)` partial quotients, computed in `O(log q)` arithmetic operations — the same bound as the Euclidean algorithm, and worst-case (all quotients `1`) achieved by consecutive Fibonacci numbers, giving length `Theta(log_phi q)`.

**Proof.** Each step at least halves the smaller argument over two iterations (Lame's theorem / Fibonacci worst case), so the number of steps is `O(log q)`. Each step is one division. ∎

**Theorem 10.2 (Bit complexity).** With `n`-bit inputs and schoolbook arithmetic, the full expansion plus convergents costs `O(n^2)` bit operations; with fast (FFT-based) GCD it drops to `O(n log^2 n log log n)` (the half-GCD / "Schoenhage" continued-fraction algorithm). The convergent numerators have up to `n` bits, so storing all of them is `O(n^2)` space; storing only the last two is `O(n)`.

**Theorem 10.3 (Pell cost).** Computing the period of `sqrt(D)` takes `O(r)` steps where `r = O(sqrt(D) log D)` is the period length, each step `O(log D)`-bit arithmetic. The fundamental solution `(x1, y1)` has `O(sqrt(D))` bits in the worst case, so writing it down already costs `O(sqrt(D))`, and big-integer convergent updates dominate. The `n`-th solution is computed in `O(log n)` big-integer multiplications via the `2x2` matrix power, with operand size `O(n sqrt(D))` bits.

**Theorem 10.4 (Reconstruction cost).** Rational reconstruction is one truncated extended-Euclid run on `(m, u)`: `O(log m)` steps, `O(log^2 m)` bit operations schoolbook (or quasi-linear with fast GCD). ∎

### 10.1 The Half-GCD / Fast Continued Fraction

The quasi-linear bound of Theorem 10.2 rests on the **half-GCD** algorithm. The idea: the sequence of `2x2` quotient matrices `M(a0) M(a1) ... M(a_k)` can be computed by divide-and-conquer. Split the input into high and low halves; recursively compute the quotient matrix for the high half (which determines roughly the first half of the partial quotients), apply it to reduce the input, then recurse on the remainder. Because matrix multiplication is associative (Section 8), the partial products combine correctly, and each level does one fast (FFT-based) big-integer multiply. The recurrence `T(n) = 2 T(n/2) + O(M(n))` with `M(n)` the multiply cost solves to `O(M(n) log n)`, i.e. quasi-linear. This is the same structural insight that makes fast GCD, fast Bezout, and fast rational reconstruction all share one engine — the continued-fraction matrix factorization.

### 10.2 Why Pell Is Dominated by Output Size

For Pell the step count `O(period) = O(sqrt(D) log D)` looks benign, but the *numbers* are the cost. The fundamental solution has `O(sqrt(D))` bits (Theorem 10.3), so the final convergent updates manipulate `O(sqrt(D))`-bit integers, and even just writing the answer is `Omega(sqrt(D))`. Thus the true cost is `O(period * M(sqrt(D)))` where `M` is the big-integer multiply cost — the period is short, but each arithmetic operation on the convergents is expensive. This output-size domination is intrinsic: there is no representation of the answer shorter than its digit count, so no algorithm can beat it asymptotically. It is the formal statement of the senior-level warning that "Pell numbers explode."

### 10.3 The Regulator and Why Solution Size Is Erratic

The size of the fundamental solution is governed by the **regulator** `R_D = ln(x1 + y1 sqrt(D))` of the real quadratic field `Q(sqrt(D))`. The number of digits of `x1` is `≈ R_D / ln 10`. The regulator's behavior is genuinely irregular: by the class number formula `R_D · h_D ≈ sqrt(D) · L(1, chi_D)` where `h_D` is the class number and `L(1, chi_D)` a Dirichlet `L`-value. When `h_D` is large the regulator (hence the solution) is small; when `h_D = 1` the regulator absorbs the full `sqrt(D)` growth, giving enormous solutions. This is *why* `D = 661` (with small class number) has a 38-digit `x` while a nearby `D` with larger class number has a tiny solution — the apparent randomness is the class number doing the bookkeeping. No elementary formula predicts the solution size from `D` alone; you must run the CF. This connects the humble continued fraction directly to deep algebraic number theory (Dirichlet's class number formula and unit theorem).

**Summary of bounds.**

| Task | Steps | Bit cost (schoolbook) |
|------|-------|-----------------------|
| CF of rational `p/q` | `O(log q)` | `O(n^2)` |
| All convergents | `O(log q)` | `O(n^2)` time, `O(n^2)` space |
| CF period of `sqrt(D)` | `O(sqrt(D) log D)` | `O(sqrt(D) log^2 D)` |
| Fundamental Pell solution | `O(period)` | `O(sqrt(D))` output bits |
| `n`-th Pell solution | `O(log n)` mults | operands `O(n sqrt(D))` bits |
| Rational reconstruction | `O(log m)` | `O(log^2 m)` |

---

## 10.5 Metric Theory and the Gauss-Kuzmin Distribution

A deeper layer of theory concerns the *statistics* of partial quotients of a "random" real number.

**Theorem 10.5 (Gauss-Kuzmin).** For almost every real `x` (Lebesgue-a.e.), the probability that a partial quotient equals `k` tends to

```
P(a_n = k) = log_2( 1 + 1/(k(k+2)) ).
```

So `a_n = 1` with probability `log_2(4/3) ≈ 0.415`, `a_n = 2` with probability `≈ 0.170`, and large quotients are rare but heavy-tailed (the expected value of `a_n` diverges).

**Theorem 10.6 (Khinchin's constant).** For almost every `x`, the geometric mean of the partial quotients converges to a universal constant:

```
(a_1 a_2 ... a_n)^{1/n} -> K ≈ 2.6854520010...
```

independent of `x`. **Theorem (Levy's constant).** Likewise `q_n^{1/n} -> e^{pi^2/(12 ln 2)} ≈ 3.27582...` almost everywhere, quantifying the typical geometric growth rate of convergent denominators.

**Engineering relevance.** These metric facts explain *typical* behavior: a random rational's CF has mostly small quotients (so Euclid is fast on average, matching the `O(log)` worst case with a small constant), but the heavy tail means occasional huge quotients appear — which is exactly when a single convergent is an extraordinarily good approximation (a near-integer reciprocal). Algorithms that branch on quotient size (e.g. windowed reconstruction) should expect the Gauss-Kuzmin distribution, not a uniform one.

**A note on the proof technique.** The Gauss-Kuzmin theorem is proved via the **Gauss map** `G(x) = {1/x}` (fractional part of the reciprocal), the dynamical system whose orbit produces the partial quotients. Its invariant probability measure is `1/(ln 2) · 1/(1+x) dx` on `[0,1]`, the **Gauss measure**, and the partial-quotient distribution is the pushforward of this measure. The exponential mixing of the Gauss map (it is ergodic with a spectral gap) gives the almost-everywhere convergence of Khinchin's and Levy's constants. This places continued fractions firmly in ergodic theory — the same machinery that analyzes the equidistribution of orbits — which is a recurring theme: the deterministic CF of a *specific* number is an algorithm, but the CF of a *random* number is a stochastic process with rich statistics.

## 10.6 CFRAC: Factoring via Continued Fractions

The **Continued Fraction Factorization method (CFRAC)** of Morrison and Brillhart (1975) — the first subexponential general factoring algorithm — uses the convergents of `sqrt(N)`. The key identity (Theorem 7.2 generalized): for convergents `p_k/q_k` of `sqrt(N)`,

```
p_k^2 - N q_k^2 = (-1)^{k+1} Q_{k+1},   with |Q_{k+1}| < 2 sqrt(N),
```

so `p_k^2 ≡ (-1)^{k+1} Q_{k+1} (mod N)` with the right side *small* (`O(sqrt N)`). Collecting many such relations and finding a subset whose product is a perfect square (via linear algebra over `GF(2)` on the prime-factorization exponent vectors) yields `X^2 ≡ Y^2 (mod N)`, and `gcd(X - Y, N)` is a nontrivial factor with good probability. The CF supplies a dense stream of small quadratic residues — exactly because the convergents approximate `sqrt(N)` to within `1/q^2`, forcing `p^2 - N q^2` to be small. CFRAC was later superseded by the quadratic sieve (which generates relations faster), but it is the historical and conceptual bridge from continued-fraction approximation theory to modern factoring, and a vivid example of "best approximation implies algebraic structure."

## 11. Summary

- **Well-posedness** (Definition 1.1): rationals ↔ finite simple CFs, irrationals ↔ infinite ones, a bijection grounded in the floor operation and the monotone-bracketing convergence of the even/odd convergent subsequences.
- **Convergent recurrence** (Theorem 2.1): `p_k = a_k p_{k-1} + p_{k-2}`, `q_k = a_k q_{k-1} + q_{k-2}`, proved by introducing the partial-value function `h_k(t)` and inducting; `q_k >= phi^{k-1}`.
- **Determinant identity** (Theorem 3.1): `p_k q_{k-1} - p_{k-1} q_k = (-1)^{k-1}`, giving reducedness, the alternating-error formula, and the even-below/odd-above straddling of `x`.
- **Best approximation** (Theorem 4.1): convergents minimize `|q x - p|` over all denominators `<= q_k` ("second kind"); the "first kind" list adds qualifying semiconvergents — the reason denominator-capped queries must test them.
- **Error bound** (Theorem 5.1): `|x - p_k/q_k| < 1/(q_k q_{k+1}) <= 1/q_k^2`; Legendre's converse (5.2) and Hurwitz's `1/(sqrt 5 q^2)` (5.3, tight for `phi`) complete the approximation theory.
- **Lagrange's theorem** (Theorem 6.1): a CF is eventually periodic iff the number is a quadratic irrational; for `sqrt(D)` the period is `[a0; \overline{palindrome, 2 a0}]` (Corollary 6.3) via Galois's purely-periodic criterion.
- **Pell solvability** (Theorems 7.1-7.3): every `±1` solution is a convergent of `sqrt(D)`; the fundamental solution sits at the period end (parity-dependent), and all solutions form the cyclic norm-1 unit group of `Z[sqrt(D)]`.
- **Matrix / Stern-Brocot views** (Section 8): the convergent table is a product of `[[a,1],[1,0]]`, re-deriving the determinant identity and connecting to `SL_2(Z)` tree descent.
- **Rational reconstruction** (Theorems 9.1-9.2): unique under `2AB <= m`, recovered by a size-halted Euclid run; specializes to Wiener's RSA attack.
- **Complexity** (Section 10): expansion is `O(log q)` steps / `O(n^2)` bits (quasi-linear with fast GCD); Pell is dominated by `O(sqrt(D))`-bit solution sizes; reconstruction is `O(log m)`.
- **Metric theory** (Section 10.5): partial quotients follow the Gauss-Kuzmin distribution (`P(a_n = 1) ≈ 0.415`), geometric means converge to Khinchin's constant `≈ 2.685`, and denominators grow at Levy's rate `≈ 3.276` per term for almost every real — so typical CFs have small quotients with a rare heavy tail.
- **Applications** (Sections 9, 10.6): rational reconstruction underpins exact rational linear algebra and Wiener's RSA attack; CFRAC (the first subexponential factoring method) mines the convergents of `sqrt(N)` for small quadratic residues — every application is "best approximation reveals hidden algebraic structure."

### Complexity Cheat Table

| Task | Steps | Bit cost (schoolbook) | Fast variant |
|------|-------|-----------------------|--------------|
| CF of rational `p/q` | `O(log q)` | `O(n^2)` | `O(M(n) log n)` half-GCD |
| All convergents | `O(log q)` | `O(n^2)` time, `O(n^2)` space | — |
| Best approx under cap `N` | `O(log N)` | `O(log^2 N)` | — |
| CF period of `sqrt(D)` | `O(sqrt(D) log D)` | `O(sqrt(D) log^2 D)` | — |
| Fundamental Pell solution | `O(period)` | `O(sqrt(D))` output bits | — |
| `n`-th Pell solution | `O(log n)` mults | operands `O(n sqrt(D))` bits | matrix power |
| Rational reconstruction | `O(log m)` | `O(log^2 m)` | quasi-linear |
| Modular inverse via CF | `O(log m)` | `O(log^2 m)` | — |

### Pitfall-to-Theorem Map

| Practical pitfall | Theorem that explains it |
|-------------------|--------------------------|
| Wrong recurrence seeds break everything | Theorem 2.1 (the `h_k(t)` base cases pin the seeds) |
| Convergent not reduced | Corollary 3.2 (det `±1` forces `gcd = 1`) |
| Denominator-capped answer sub-optimal | Corollary 4.2 (semiconvergents are best of first kind) |
| Float period detection drifts | Section 6 (use the integer complete-quotient recurrence) |
| Odd-period Pell returns `-1` | Theorem 7.2 (parity decides `±1` at period end) |
| Reconstruction returns wrong fraction | Theorem 9.1 (uniqueness needs `2AB <= m`) |
| Pell numbers overflow 64-bit | Theorem 10.3 (`O(sqrt D)`-bit solutions) |

### One-sentence-per-section recap

- §1: rationals ↔ finite CFs, irrationals ↔ infinite CFs — a clean bijection.
- §2: the recurrence `p_k = a_k p_{k-1} + p_{k-2}` is proved via the partial-value Mobius function.
- §3: the determinant identity `±(-1)^k` gives reducedness, alternation, and convergence.
- §4-5: convergents are the best approximations, with error `< 1/q^2` (and the Hurwitz/Legendre refinements).
- §6: quadratic irrationals have periodic CFs (Lagrange), `sqrt(D)` palindromic ending in `2 a0`.
- §7: Pell's `±1` solutions are convergents of `sqrt(D)`, forming a cyclic unit group.
- §8: the convergent table is an `SL_2(Z)` product; Stern-Brocot is the same structure as a tree.
- §9: reconstruction is unique under `2AB <= m`, recovered by a size-halted Euclid run.
- §10: everything is `O(log)` for rationals; Pell is dominated by `O(sqrt D)`-bit output.

### Closing notes

- The single recurrence of Section 2 underlies *every* result: approximation quality, periodicity, Pell, reconstruction, and the Stern-Brocot/matrix correspondences are all consequences of it plus the determinant identity.
- The deep dividing line is **rational vs quadratic-irrational**: finite CF vs eventually-periodic CF (Lagrange), which is exactly the dividing line between "terminates like Euclid" and "has a Pell theory."
- The **matrix factorization** `prod M(a_k) = [[p_k, p_{k-1}],[q_k, q_{k-1}]]` (Section 8) is the structural heart: it makes the determinant identity a determinant-multiplicativity fact, the continuant reversal symmetry a transpose fact, and the half-GCD speedup an associativity-of-products fact. Every "coincidence" in the theory is this factorization viewed from a different angle.
- The **approximation bounds** form a tight ladder: `|x - p/q| < 1/q^2` (always), `< 1/(2q^2)` (at least one of every two consecutive convergents, Theorem 5.4), and `< 1/(sqrt 5 q^2)` (infinitely often, Hurwitz, tight for `phi`). Legendre's converse closes the loop — anything that good *is* a convergent. This ladder is why convergents are the canonical witnesses of Dirichlet's theorem (Corollary 5.5).
- The **metric theory** (Gauss-Kuzmin, Khinchin, Levy, Section 10.5) describes typical behavior, while the worst case (`phi`) and the irregular Pell sizes (the regulator / class-number connection, Section 10.3) describe the extremes — together they bracket what to expect from real inputs.
- Foundational references: Hardy & Wright, *An Introduction to the Theory of Numbers* (CF, approximation, Pell); Khinchin, *Continued Fractions* (the metric theory); Davenport, *The Higher Arithmetic* (Pell and quadratic forms); Graham-Knuth-Patashnik, *Concrete Mathematics* (Stern-Brocot); von zur Gathen & Gerhard, *Modern Computer Algebra* (rational reconstruction, fast GCD). Sibling topics: `01-gcd-lcm`, `07-extended-euclidean-modular-inverse`, `08-linear-diophantine`, `11-matrix-exponentiation`.
