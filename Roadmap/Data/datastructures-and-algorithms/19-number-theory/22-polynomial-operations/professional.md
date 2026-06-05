# Polynomial Operations — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions (polynomial ring, degree, evaluation homomorphism)
2. F[x] as a Euclidean Domain (the division algorithm, worked division)
3. Roots, the Factor Theorem, and Degree Bounds (non-field failure)
4. Interpolation: Existence and Uniqueness (Lagrange + Vandermonde, worked)
5. Lagrange and Newton Forms (correctness, barycentric, divided differences)
6. Polynomial GCD: Correctness and Bézout (worked Euclid, extended Euclid)
7. The Formal Derivative and Square-Free Factorization (repeated-factor test)
8. Newton Iteration: Quadratic (Doubling) Convergence (inverse/log/exp/sqrt, GF recurrences)
9. Convolution, the Evaluation–Interpolation Duality, and FFT/NTT (roots of unity, quotient rings/finite fields)
10. Complexity Landscape and Lower Bounds (Karatsuba recurrence, subproduct tree)
11. Summary

---

## 1. Formal Definitions

This document gives the rigorous foundations behind the operations introduced operationally in [`junior.md`](./junior.md) (representation, multiply, evaluate), [`middle.md`](./middle.md) (division, interpolation, GCD), and [`senior.md`](./senior.md) (NTT, Newton iteration). Each proof here justifies a claim those files used: why division is unique, why interpolation through `n+1` points is unique, why Euclid terminates, and why Newton iteration converges in `log n` steps.

Let `F` be a field (e.g. `Q`, `R`, `C`, or `F_p = Z/pZ` for prime `p`).

**Definition 1.1 (Polynomial ring).** `F[x]` is the set of finite formal sums `P = Σ_{i=0}^{d} a_i x^i` with `a_i ∈ F`, with addition coefficient-wise and multiplication by convolution:

```
(P + Q)[k] = P[k] + Q[k],     (P · Q)[k] = Σ_{i+j=k} P[i] · Q[j].
```

**Definition 1.1b (Evaluation map).** For `α ∈ F`, evaluation `ev_α : F[x] → F`, `P ↦ P(α) = Σ a_i α^i`, is a ring homomorphism: `ev_α(P+Q) = ev_α(P) + ev_α(Q)` and `ev_α(PQ) = ev_α(P)·ev_α(Q)`. This single fact underlies Horner's rule, the factor theorem (Section 3), and the convolution theorem (Section 9) — multiplication of polynomials becomes multiplication of *values* at each evaluation point, which is precisely why transforming to point-values makes multiplication pointwise.

**Definition 1.2 (Degree).** `deg P = max{ i : a_i ≠ 0 }`, with the convention `deg 0 = −∞`. The **leading coefficient** `lc(P)` is `a_{deg P}`. `P` is **monic** if `lc(P) = 1`.

**Proposition 1.3 (Degree of a product).** Over a field (more generally an integral domain), `deg(P·Q) = deg P + deg Q`, because `lc(P·Q) = lc(P)·lc(Q) ≠ 0` (a field has no zero divisors). Consequently `F[x]` is an **integral domain**.

**Definition 1.4 (Divisibility).** `B | A` (`B` divides `A`) if `A = B·Q` for some `Q ∈ F[x]`. A **greatest common divisor** of `A, B` is a divisor of both of maximal degree; it is unique up to a nonzero scalar (we canonicalize by taking the **monic** gcd).

**Worked degree example.** Over `F_5`, let `P = 2x² + 1` (degree 2, `lc = 2`) and `Q = 3x + 4` (degree 1, `lc = 3`). Then `lc(P·Q) = 2·3 = 6 ≡ 1 (mod 5) ≠ 0`, so `deg(P·Q) = 3`, confirming Proposition 1.3. The product is `2x²·(3x+4) + 1·(3x+4) = 6x³ + 8x² + 3x + 4 ≡ x³ + 3x² + 3x + 4 (mod 5)`. The leading coefficient survived because `F_5` has no zero divisors — over `Z/6Z`, `2·3 = 0` would have *dropped* the degree, breaking the proposition and every algorithm that relies on it.

**Notation conventions.** Throughout, `n` denotes a degree or the number of coefficients (`n = deg + 1`), `p` a prime modulus, `M(n)` the cost of multiplying two degree-`n` polynomials, and `ω` a root of unity (FFT/NTT) — distinguished by context from any matrix-multiplication exponent. "Series mod `x^n`" means the quotient ring `F[x]/(x^n)`, i.e. coefficients of `x^0, …, x^{n-1}`. The valuation `v_x(P)` is the least index with a nonzero coefficient (`v_x(0) = +∞`); the doubling proofs of Section 8 are statements about `v_x` of an error series. We write `lc(P)` for the leading coefficient and `[x^k]P` for the coefficient of `x^k` in `P`. All "mod `p`" reductions are coefficient-wise; "mod `m(x)`" is polynomial reduction by the division algorithm (Theorem 2.1).

**Why this topic is foundational.** Polynomials over `F_p` are the substrate for a remarkable range of number-theory and combinatorics machinery: generating functions (multiplication = convolution = combining structures), the NTT (sibling `15-ntt`, which *is* evaluation/interpolation at roots of unity), finite-field arithmetic `F_{p^d} = F_p[x]/(m)` (Section 9.3), Reed-Solomon codes and Shamir secret sharing (interpolation, Section 4), and linear-recurrence evaluation (the companion-matrix / characteristic-polynomial duality with sibling `11-matrix-exponentiation`). The theorems below are the rigorous core under all of it.

---

## 2. F[x] as a Euclidean Domain (The Division Algorithm)

**Theorem 2.1 (Division algorithm).** For `A, B ∈ F[x]` with `B ≠ 0`, there exist **unique** `Q, R ∈ F[x]` with

```
A = B·Q + R   and   deg R < deg B.
```

**Proof (existence, by strong induction on `deg A`).** If `deg A < deg B`, take `Q = 0, R = A`. Otherwise let `n = deg A ≥ m = deg B`. The term `t = (lc(A)/lc(B)) · x^{n−m}` (well-defined because `lc(B) ≠ 0` is invertible in the field `F`) satisfies `deg(A − B·t) < n`, since it cancels the leading term of `A`. By the induction hypothesis applied to `A' = A − B·t` (lower degree), `A' = B·Q' + R` with `deg R < deg B`. Then `A = B·(Q' + t) + R`, completing existence.

**Proof (uniqueness).** Suppose `A = B·Q_1 + R_1 = B·Q_2 + R_2` with both remainders of degree `< deg B`. Then `B·(Q_1 − Q_2) = R_2 − R_1`. The right side has degree `< deg B`; the left side, if `Q_1 ≠ Q_2`, has degree `≥ deg B` (by Proposition 1.3). The only escape is `Q_1 = Q_2`, whence `R_1 = R_2`. ∎

**Corollary 2.2 (Euclidean domain).** With the degree as Euclidean function, `F[x]` is a Euclidean domain. Hence it is a principal ideal domain and a unique factorization domain, and the Euclidean GCD algorithm (Section 6) terminates and is correct.

**Remark (why a field).** The construction divides by `lc(B)`. Over a ring that is not a field (e.g. `Z`, or `Z/6Z`), `lc(B)` may not be invertible and the algorithm fails for non-monic `B`. This is the formal reason every division-based operation in this topic demands a **prime** modulus (so `F_p` is a field).

### 2.1 Worked division

Over `F_7`, divide `A = x³ + 2x + 1` by `B = 2x + 3`. Here `lc(B) = 2`, and `2^{-1} = 4 (mod 7)` since `2·4 = 8 ≡ 1`.

```
Step k=2: leading term of R = x³; quotient coeff = 1·4 = 4 → Q gets 4x².
          subtract 4x²·(2x+3) = 8x³+12x² ≡ x³+5x²; R = (x³+2x+1) − (x³+5x²) = 2x²+2x+1 (mod 7)
Step k=1: leading term 2x²; coeff = 2·4 = 8 ≡ 1 → Q gets 1·x.
          subtract x·(2x+3) = 2x²+3x; R = (2x²+2x+1) − (2x²+3x) = −x+1 ≡ 6x+1 (mod 7)
Step k=0: leading term 6x; coeff = 6·4 = 24 ≡ 3 → Q gets 3.
          subtract 3·(2x+3) = 6x+9 ≡ 6x+2; R = (6x+1) − (6x+2) = −1 ≡ 6 (mod 7)
```

So `Q = 4x² + x + 3`, `R = 6`, and indeed `deg R = 0 < 1 = deg B`. Check: `B·Q + R = (2x+3)(4x²+x+3) + 6`. Expanding mod 7 recovers `x³ + 2x + 1`, confirming Theorem 2.1's existence and the uniqueness of this `(Q, R)` pair.

---

## 3. Roots, the Factor Theorem, and Degree Bounds

**Theorem 3.1 (Factor theorem).** For `α ∈ F`, `(x − α) | P` iff `P(α) = 0`.

**Proof.** Divide `P` by `(x − α)`: `P = (x − α)·Q + R` with `deg R < 1`, so `R` is a constant `r ∈ F`. Evaluating at `α`: `P(α) = 0·Q(α) + r = r`. Thus `r = P(α)`, and `(x − α) | P` iff `r = 0` iff `P(α) = 0`. ∎

**Remark.** The single division step computing `r = P(α)` *is* Horner's rule: the remainder of `P / (x − α)` is exactly `P(α)`, and the quotient's coefficients are the running Horner accumulators.

**Theorem 3.2 (Degree bound on roots).** A nonzero `P ∈ F[x]` of degree `n` has at most `n` roots in `F`.

**Proof (induction on `n`).** Base `n = 0`: a nonzero constant has no roots. Step: if `P` has a root `α`, then `P = (x − α)·Q` with `deg Q = n − 1` (Theorem 3.1, Proposition 1.3). Any root `β ≠ α` of `P` satisfies `(β − α)·Q(β) = 0`; since `β − α ≠ 0` in a field, `Q(β) = 0`, so `β` is a root of `Q`. By induction `Q` has `≤ n − 1` roots, so `P` has `≤ n` roots. ∎

This degree bound is the linchpin of interpolation uniqueness (Section 4) and is **false** over rings with zero divisors (e.g. `x² − 1` has four roots `±1, ±3` mod 8), reinforcing the field requirement.

### 3.1 Worked root-bound failure over a non-field

Over `Z/8Z` (not a field; `2, 4, 6` are zero divisors), consider `P = x² − 1`. Evaluating: `P(1) = 0`, `P(3) = 9 − 1 = 8 ≡ 0`, `P(5) = 25 − 1 = 24 ≡ 0`, `P(7) = 49 − 1 = 48 ≡ 0`. A degree-2 polynomial with **four** roots — impossible over a field. The factorization `x² − 1 = (x−1)(x+1)` is no longer the whole story because `(x−3)(x−5) = x² − 8x + 15 ≡ x² + 7 ≡ x² − 1 (mod 8)` is a *different* factorization. The loss of unique factorization is exactly the loss of the field structure, and it is why interpolation, GCD, and division all silently misbehave over composite moduli.

---

## 4. Interpolation: Existence and Uniqueness

**Theorem 4.1 (Interpolation).** Given `n+1` pairs `(x_0, y_0), …, (x_n, y_n)` with the `x_i ∈ F` **pairwise distinct**, there exists a **unique** polynomial `P ∈ F[x]` with `deg P ≤ n` and `P(x_i) = y_i` for all `i`.

**Proof (uniqueness, via Theorem 3.2).** Suppose `P` and `Q` both have degree `≤ n` and agree at all `n+1` nodes. Then `D = P − Q` has degree `≤ n` and `D(x_i) = 0` for `n+1` distinct `x_i`. A nonzero degree-`≤ n` polynomial has at most `n` roots (Theorem 3.2), so `D` must be the zero polynomial; hence `P = Q`.

**Proof (existence, via Lagrange construction).** Define

```
L_i(x) = Π_{j≠i} (x − x_j) / (x_i − x_j).
```

Each factor's denominator `x_i − x_j ≠ 0` because the nodes are distinct, so `L_i` is well-defined over the field. By construction `L_i(x_i) = 1` and `L_i(x_j) = 0` for `j ≠ i` (one numerator factor vanishes). Then `P = Σ_i y_i L_i` has degree `≤ n` and `P(x_k) = Σ_i y_i L_i(x_k) = y_k`. Existence holds. ∎

**Corollary 4.2 (Vandermonde nonsingularity).** The coefficient-finding linear system has matrix `V[i][j] = x_i^j` (Vandermonde), with `det V = Π_{i<j}(x_j − x_i) ≠ 0` exactly when the `x_i` are distinct. Theorem 4.1 is the polynomial restatement that this system is uniquely solvable. The two viewpoints — Lagrange basis vs solving `V·a = y` — are the same fact, and the latter ties interpolation to sibling `19-gaussian-elimination` (solving the linear system directly costs `O(n³)`, worse than the `O(n²)` interpolation methods, which is why the structure matters).

**Remark (counting interpretation).** "`n+1` points determine a unique degree-`≤ n` polynomial" is the exact statement that the evaluation map `F[x]_{≤ n} → F^{n+1}`, `P ↦ (P(x_0), …, P(x_n))`, is a vector-space isomorphism for distinct nodes. This is the algebraic backbone of Reed-Solomon codes, secret sharing (Shamir), and the FFT evaluation/interpolation duality (Section 9).

### 4.1 Worked interpolation and a uniqueness sanity check

Over `Q` (or any large prime field), interpolate `(0,1), (1,2), (2,5)`. The Lagrange basis on nodes `0,1,2`:

```
L_0(x) = (x−1)(x−2) / ((0−1)(0−2)) = (x²−3x+2)/2
L_1(x) = (x−0)(x−2) / ((1−0)(1−2)) = (x²−2x)/(−1) = −x²+2x
L_2(x) = (x−0)(x−1) / ((2−0)(2−1)) = (x²−x)/2
```

Then `P = 1·L_0 + 2·L_1 + 5·L_2`. Collecting the `x²` coefficient: `1/2 + 2·(−1) + 5/2 = 1/2 − 2 + 5/2 = 1`. The `x` coefficient: `−3/2 + 2·2 + 5·(−1/2) = −3/2 + 4 − 5/2 = 0`. The constant: `1`. So `P = x² + 1`, matching the data, and `P(3) = 10`. **Uniqueness check:** any other degree-`≤2` polynomial agreeing at `0,1,2` would differ from `P` by a degree-`≤2` polynomial with 3 roots — forced to be zero by Theorem 3.2. There is no second answer.

---

## 5. Lagrange and Newton Forms (Correctness)

### 5.1 Lagrange correctness

The Lagrange interpolant `P = Σ_i y_i L_i` is correct by the construction in Theorem 4.1's existence proof. Building all coefficients costs `O(n²)` (each `L_i` is an `O(n)`-degree product, and there are `n+1` of them, with `O(n)` work to fold each in). Evaluating at a single new point `x*` is `O(n)` after `O(n)` precomputation of prefix/suffix products of `(x* − x_j)`.

**Barycentric form.** Defining the weights `w_i = 1 / Π_{j≠i}(x_i − x_j)`, the interpolant rewrites as
```
P(x) = ( Σ_i w_i y_i / (x − x_i) ) / ( Σ_i w_i / (x − x_i) ),   for x ∉ {x_i}.
```
The weights `w_i` are computed once in `O(n²)`; thereafter each new evaluation point costs `O(n)`. This is the numerically and computationally preferred Lagrange evaluation in practice (the second barycentric form), and over `F_p` it needs `n` modular inverses for the `(x − x_i)` terms, all batchable with a single inverse via the prefix-product trick (sibling `07-extended-euclidean-modular-inverse` / batched inversion). The barycentric weights are exactly the reciprocals of the master polynomial's derivative values, `w_i = 1/M'(x_i)`, linking Lagrange to the subproduct-tree interpolation of Section 10.4.

### 5.2 Newton form and divided differences

**Definition 5.1 (Divided differences).**
```
f[x_i] = y_i,
f[x_i, …, x_{i+k}] = ( f[x_{i+1}, …, x_{i+k}] − f[x_i, …, x_{i+k−1}] ) / (x_{i+k} − x_i).
```

**Theorem 5.2 (Newton form).** The unique interpolant equals
```
P(x) = Σ_{k=0}^{n} f[x_0, …, x_k] · Π_{j=0}^{k−1} (x − x_j).
```

**Proof (induction on the number of nodes).** Let `P_k` interpolate the first `k+1` nodes. `P_0 = y_0` is constant and correct. Suppose `P_{k−1}` interpolates `x_0, …, x_{k−1}`. Define `P_k = P_{k−1} + c_k · Π_{j<k}(x − x_j)`. The added term vanishes at `x_0, …, x_{k−1}`, so `P_k` still matches there for any `c_k`. Choose `c_k` so `P_k(x_k) = y_k`:
```
c_k = ( y_k − P_{k−1}(x_k) ) / Π_{j<k}(x_k − x_j).
```
A standard induction identifies this `c_k` with the divided difference `f[x_0, …, x_k]` (both satisfy the same recurrence and base case). Thus `P_n` is the interpolant, in Newton form. ∎

**Corollary 5.3 (Incrementality).** Adding a node `(x_{n+1}, y_{n+1})` appends one divided difference and one product term, costing `O(n)` — no rebuild. This is the structural reason Newton is preferred for streaming data, while Lagrange is preferred when all nodes are fixed and only point-values are needed. Both yield the same polynomial (Theorem 4.1's uniqueness), so the choice is purely about update/evaluation cost, never about the answer.

### 5.3 Worked divided-difference table

Reuse the data `(0,1), (1,2), (2,5)` (on `x² + 1`). The divided-difference table:

```
f[x_0] = 1
f[x_1] = 2          f[x_0,x_1] = (2−1)/(1−0) = 1
f[x_2] = 5          f[x_1,x_2] = (5−2)/(2−1) = 3      f[x_0,x_1,x_2] = (3−1)/(2−0) = 1
```

So the Newton coefficients are `c_0 = 1, c_1 = 1, c_2 = 1`, giving
```
P(x) = 1 + 1·(x−0) + 1·(x−0)(x−1) = 1 + x + x(x−1) = 1 + x + x² − x = x² + 1.
```
Same polynomial as the Lagrange computation (§4.1) — Theorem 4.1's uniqueness in action. **Incremental check:** to add a new point `(3, 10)`, compute one new diagonal of divided differences (`f[x_2,x_3], f[x_1,x_2,x_3], f[x_0,…,x_3]`) and append `c_3·(x)(x−1)(x−2)`; since `(3,10)` already lies on `x²+1`, `c_3 = 0` and the polynomial is unchanged — the `O(n)` update added nothing, correctly.

### 5.4 Vandermonde determinant (existence via linear algebra)

The coefficient-finding system `V·a = y` with `V[i][j] = x_i^j` has the classical determinant
```
det V = Π_{0 ≤ i < j ≤ n} (x_j − x_i).
```
**Proof (induction / column operations).** Subtract `x_0`-times each column from the next to introduce factors `(x_i − x_0)` in every row but the first, expand along the first row, and recurse on the remaining `n × n` Vandermonde in variables `x_1, …, x_n`. The product form follows. ∎ When the `x_i` are distinct every factor is nonzero, so `det V ≠ 0` and the system has a unique solution — the linear-algebra proof of Theorem 4.1, dual to the Lagrange-basis proof.

---

## 6. Polynomial GCD: Correctness and Bézout

**Algorithm (Euclid in F[x]).**
```
GCD(A, B):
  while B ≠ 0:
    (Q, R) := DIVMOD(A, B)      # Theorem 2.1
    (A, B) := (B, R)
  return MONIC(A)
```

**Theorem 6.1 (Correctness).** `GCD(A, B)` returns the monic greatest common divisor of `A` and `B`.

**Proof.** *Invariant:* `gcd(A, B) = gcd(B, R)` (as ideals/divisor sets), because `A = B·Q + R` means every common divisor of `B, R` divides `A`, and every common divisor of `A, B` divides `R = A − B·Q`. So the set of common divisors is preserved each iteration. *Termination:* `deg R < deg B` strictly (Theorem 2.1), so the degree of the second argument strictly decreases each step and reaches `−∞` (the zero polynomial) in at most `deg B + 1` iterations. At termination `B = 0`, and `gcd(A, 0) = A` (everything divides 0; `A`'s divisors are the common divisors). Canonicalizing to monic removes the scalar ambiguity. ∎

**Termination bound (sharper).** The remainder degrees form a strictly decreasing sequence `deg B > deg R_1 > deg R_2 > … ≥ 0`, so there are at most `deg B + 1 ≤ n + 1` iterations. Each iteration's division costs `O((deg current − deg next + 1)·deg next)`; summing the telescoping degree drops gives `O(n²)` total schoolbook work, not `O(n³)` — a frequently-misquoted bound. The `O(n log² n)` Half-GCD improves the *number-of-iterations × cost* product by handling top-half degree blocks at once.

**Theorem 6.2 (Bézout / extended Euclid).** There exist `U, V ∈ F[x]` with `U·A + V·B = gcd(A, B)`, computable by tracking coefficients through the same recurrence (the polynomial analogue of sibling `07-extended-euclidean-modular-inverse`).

**Proof sketch.** Maintain `(s, t)` and `(s', t')` with `s·A + t·B = (current first arg)` and `s'·A + t'·B = (current second arg)`. The update mirrors the integer extended Euclid: on `(A, B) ← (B, A − Q·B)`, set `(s, t, s', t') ← (s', t', s − Q·s', t − Q·t')`. The invariant is preserved; at termination the first row gives `U, V`. ∎

**Consequence (square-free test).** `P` has a repeated root iff `gcd(P, P') ≠ 1` (a constant), by Theorem 7.2 below. The GCD of `P` and its formal derivative isolates the repeated-factor part — the first step of square-free factorization. Complexity: `O(n)` division steps, schoolbook `O(n²)` total with telescoping remainder degrees; Half-GCD achieves `O(M(n) log n) = O(n log² n)` (Section 10).

### 6.1 Worked Euclidean GCD

Over `Q` (or a large prime field), take `A = x³ − 2x² − x + 2 = (x−1)(x+1)(x−2)` and `B = x² − 3x + 2 = (x−1)(x−2)`. The common factor is `(x−1)(x−2) = B` itself, so we expect `gcd = B` (monic).

```
A mod B:  x³ − 2x² − x + 2 = (x² − 3x + 2)(x + 1) + R.
          (x²−3x+2)(x+1) = x³ − 2x² − x + 2,  so R = 0.
B = 0?  no, but the new remainder is 0, so next:
A ← B = x² − 3x + 2,  B ← R = 0.
Loop ends (B = 0). gcd = monic(x² − 3x + 2) = x² − 3x + 2.
```

The remainder hit zero in one step because `B | A` exactly. The invariant `gcd(A,B) = gcd(B, A mod B)` held throughout, and the strictly-decreasing remainder degree guaranteed termination. Had `A` and `B` shared only `(x−1)`, the algorithm would have taken one more step, producing a degree-1 remainder before terminating at the monic `x − 1`.

### 6.2 Worked extended Euclid (Bézout)

For `A = x² − 1` and `B = x − 1` over `Q`: `A = (x−1)(x+1)`, so `gcd = x − 1 = B`. The extended algorithm tracks `U·A + V·B`. Since `B | A`, after one step `A mod B = 0` and the Bézout identity is simply `0·A + 1·B = B = gcd`, i.e. `U = 0, V = 1`. For coprime inputs the same bookkeeping yields a nonconstant `U, V` — the polynomial analogue of computing a modular inverse (sibling `07-extended-euclidean-modular-inverse`), which is exactly how one inverts an element of `F_p[x]/(m(x))` when `m` is irreducible.

---

## 7. The Formal Derivative and Square-Free Factorization

**Definition 7.1 (Formal derivative).** For `P = Σ a_i x^i`, `P' = Σ_{i≥1} i·a_i x^{i−1}`, where `i·a_i` means adding `a_i` to itself `i` times in `F` (so `i` is reduced mod `p` over `F_p`). The product and sum rules hold formally: `(PQ)' = P'Q + PQ'`, `(P+Q)' = P' + Q'`.

**Theorem 7.2 (Repeated factor criterion).** Over a field, an irreducible factor `g` of `P` is repeated (i.e. `g² | P`) iff `g | gcd(P, P')`, **provided** the characteristic does not divide the relevant multiplicities (always safe when `char F = 0` or `p > deg P`).

**Proof.** Write `P = g^e · h` with `g ∤ h`. Then `P' = e·g^{e−1}·g'·h + g^e·h' = g^{e−1}(e·g'·h + g·h')`. If `e ≥ 2`, `g | g^{e−1}` divides both `P` and `P'`. If `e = 1`, `P' = g'·h + g·h'`, and `g | P'` would force `g | g'·h`; since `g ∤ h` and `deg g' < deg g` (so `g ∤ g'` unless `g' = 0`), `g ∤ P'` in characteristic 0 or when `p ∤ e`. ∎

**Characteristic caveat.** In `F_p`, `(x^p)' = p·x^{p−1} = 0`, so derivatives can vanish unexpectedly and the criterion needs care (Frobenius / `p`-th power handling). The clean regime is `p > deg P`, which also makes the formal **integral** `∫P [i+1] = a_i / (i+1)` well-defined (every `i+1 ≤ deg P + 1 < p` is invertible). This is the formal justification for the `senior.md` requirement that the prime exceed the degree.

### 7.1 Worked square-free detection

Over `Q`, test `P = (x − 1)² = x² − 2x + 1`. Its derivative is `P' = 2x − 2 = 2(x − 1)`. Compute `gcd(P, P')`: dividing `P` by `P'` gives quotient `(x−1)/2` and remainder `0`, so `gcd = x − 1` (monic), a **nonconstant** — hence `P` has a repeated factor (Theorem 7.2). Contrast `P = (x−1)(x−2) = x² − 3x + 2`, `P' = 2x − 3`. Here `gcd(P, P')` is a constant (the two share no root), so this `P` is **square-free**. The criterion never factors `P` — it only runs one GCD — which is why it is the cheap first step of every square-free factorization routine.

### 7.2 The chain to factorization

Square-free factorization splits `P = Π P_i^i` into square-free parts `P_i`. The recipe iterates `gcd(P, P')`: the GCD captures all repeated factors with multiplicity reduced by one, and dividing out separates the multiplicity-1 part. Over `F_p` with `p > deg P` this terminates cleanly; in small characteristic the `p`-th-power Frobenius branch must be handled separately (taking `p`-th roots of the part whose derivative vanished). Full factorization into irreducibles (Cantor-Zassenhaus, Berlekamp) builds on square-free factorization plus the structure of `F_p[x]/(P)`, but those are beyond this topic; the derivative-GCD test is the entry point.

---

## 8. Newton Iteration: Quadratic (Doubling) Convergence

The advanced power-series operations (inverse, log, exp, sqrt mod `x^n`) all rely on Newton iteration in the ring `F[x]/(x^n)`. The key is that the relevant error is measured by the `x`-adic valuation, and each step squares it.

**Theorem 8.1 (Series inverse, doubling).** Let `B ∈ F[[x]]` with `B(0) ≠ 0`. If `g_t` satisfies `B·g_t ≡ 1 (mod x^t)`, then
```
g_{2t} := g_t·(2 − B·g_t)   satisfies   B·g_{2t} ≡ 1 (mod x^{2t}).
```

**Proof.** Let `e = 1 − B·g_t`. By hypothesis `e ≡ 0 (mod x^t)`, i.e. `x^t | e`. Compute
```
1 − B·g_{2t} = 1 − B·g_t·(2 − B·g_t) = 1 − 2B·g_t + (B·g_t)²
            = (1 − B·g_t)² = e².
```
Since `x^t | e`, we have `x^{2t} | e²`, so `B·g_{2t} ≡ 1 (mod x^{2t})`. ∎

### 8.0b Worked series inverse

Invert `B = 1 − x` modulo `x^4` (the true inverse is `1 + x + x² + x³ + …`). Start `g_1 = B(0)^{−1} = 1` (correct mod `x^1`).

```
Step to mod x^2:  B·g_1 = (1−x)·1 = 1 − x;  2 − B·g_1 = 1 + x.
                  g_2 = g_1·(1 + x) = 1 + x   (mod x^2). ✓ (matches 1 + x)
Step to mod x^4:  B·g_2 = (1−x)(1+x) = 1 − x²;  2 − B·g_2 = 1 + x².
                  g_4 = g_2·(1 + x²) = (1 + x)(1 + x²) = 1 + x + x² + x³  (mod x^4). ✓
```

Each step doubled the count of correct coefficients (1 → 2 → 4), exactly as Theorem 8.1 guarantees, and `g_4 = 1 + x + x² + x³` is the geometric series truncated to `x^4`. Verify: `(1 − x)(1 + x + x² + x³) = 1 − x^4 ≡ 1 (mod x^4)`.

**Theorem 8.2 (General Newton step).** To solve `Φ(g) = 0` for a series `g` (where `Φ` is an analytic operator with invertible linearization `Φ'`), the iteration `g_{2t} = g_t − Φ(g_t)/Φ'(g_t)` doubles the valuation of the error `g_t − g*` from `≥ t` to `≥ 2t`, because Taylor expansion gives `Φ(g_t) = Φ'(g*)(g_t − g*) + O((g_t − g*)²)` and the correction cancels the linear term, leaving error `O((g_t − g*)²)`.

- **Inverse:** `Φ(g) = 1/g − B`, recovering Theorem 8.1.
- **Square root:** `Φ(g) = g² − B`, step `g_{2t} = (g_t + B·g_t^{−1})/2`.
- **Logarithm:** not a root-find; use `log B = ∫ B'/B`, exact in one pass given an inverse.
- **Exponential:** `Φ(g) = log g − B`, step `g_{2t} = g_t·(1 + B − log g_t)`.

**Theorem 8.3 (Complexity).** Each Newton step at precision `t` costs `O(M(t))` (a constant number of length-`t` multiplications, plus `O(t)` work). Summing over precisions `1, 2, 4, …, n`:
```
Σ_{i=0}^{log n} M(2^i) = O(M(n)),    since M is super-additive (M(2t) ≥ 2M(t)).
```
With NTT multiply `M(n) = O(n log n)`, all of inverse/log/exp/sqrt mod `x^n` cost `O(n log n)`. ∎

The geometric-series collapse — the final full-length step dominates — is exactly why doubling precision (rather than incrementing) is essential: incrementing would cost `n` steps of `O(M(n))` each, `O(n·M(n))`, losing the whole advantage.

### 8.4 Worked log and exp

Compute `log B mod x^4` for `B = 1 + x` (note `B(0) = 1`, the precondition). Over `Q`, `log(1+x) = x − x²/2 + x³/3 − …`. Via `log B = ∫ B'/B`: `B' = 1`, and `B^{−1} = 1 − x + x² − x³ (mod x^4)`. Then `B'/B = 1 − x + x² − x³`, and integrating (coefficient `i` divided by `i+1`):

```
∫(1 − x + x² − x³) = 0 + x − x²/2 + x³/3 − x⁴/4
truncated to x^4:  log(1+x) ≡ x − x²/2 + x³/3  (mod x^4). ✓
```

Now `exp` of that result should recover `1 + x` back. Starting `g_1 = 1` and applying `g ← g·(1 + B − log g)` with `B = x − x²/2 + x³/3` doubles correct coefficients each step, converging to `exp(log(1+x)) = 1 + x` (mod `x^4`). The round-trip `exp(log B) ≡ B` is precisely the property test recommended in `senior.md`: it validates both operations against each other without an external oracle.

### 8.4b Worked series square root

Compute `sqrt(B) mod x^4` for `B = 1 + x` over a field where `2` is invertible (e.g. `Q` or `F_p`, `p` odd). The constant term `B(0) = 1` is a quadratic residue with `sqrt(1) = 1`, so seed `g_1 = 1`. Newton step `g ← (g + B·g^{−1})/2`:

```
mod x^2:  g^{-1} = 1;  B·g^{-1} = 1 + x;  g = (1 + (1+x))/2 = 1 + x/2.
mod x^4:  g = 1 + x/2 ; g^{-1} = 1 − x/2 + x²/4 − … (series inverse mod x^4);
          B·g^{-1} computed, averaged with g, yields  1 + x/2 − x²/8 + x³/16  (mod x^4).
```

This matches the binomial series `(1+x)^{1/2} = 1 + x/2 − x²/8 + x³/16 − …`. Verify by squaring: `(1 + x/2 − x²/8 + x³/16)² ≡ 1 + x (mod x^4)`. The precondition `B(0)` a quadratic residue is what made the seed `g_1` exist; over `F_p` you obtain it via Tonelli-Shanks (sibling `14-tonelli-shanks`).

### 8.5 Why the preconditions are forced

The constant-term preconditions are not arbitrary — each is the condition for the relevant `Φ'` to be invertible at the starting point:

- **Inverse / division** need `B(0) ≠ 0` so `B(0)^{−1}` (the order-1 seed) exists.
- **`log`** needs `B(0) = 1` so `log B(0) = 0` and the series has no constant-term obstruction (the integral of `B'/B` starts cleanly).
- **`exp`** needs `B(0) = 0` so `exp B(0) = 1` is the seed (exp of a nonzero constant is not a power series with rational coefficients in general over `F_p`).
- **`sqrt`** needs `B(0)` to be a quadratic residue mod `p` so the order-1 seed `sqrt(B(0))` exists in `F_p` (computed via Tonelli-Shanks, sibling `14-tonelli-shanks`).

Violating any of these makes the order-1 Newton seed undefined, which is why a production implementation validates `B[0]` before the first iteration.

---

## 9. Convolution, the Evaluation–Interpolation Duality, and FFT/NTT

**Definition 9.1 (Convolution).** Polynomial multiplication is the linear (acyclic) convolution `c_k = Σ_{i+j=k} a_i b_j`. The DFT/NTT diagonalizes *cyclic* convolution; padding to length `≥ deg(A)+deg(B)+1` makes cyclic and acyclic convolution coincide.

**Theorem 9.2 (Convolution theorem).** Let `ω` be a primitive `N`-th root of unity in `F` (`F = C` for FFT; `F = F_p` with `N | p−1` for NTT). The evaluation map `DFT(P) = (P(ω^0), …, P(ω^{N−1}))` satisfies
```
DFT(A · B) = DFT(A) ⊙ DFT(B)   (pointwise product),
```
so `A·B = DFT^{−1}( DFT(A) ⊙ DFT(B) )`.

**Proof.** Evaluation is a ring homomorphism `F[x]/(x^N − 1) → F^N` (the `x^N − 1` because `ω^N = 1`); under it multiplication becomes pointwise. Invertibility of `DFT` (a scaled inverse-Vandermonde at roots of unity, nonsingular by Corollary 4.2 since the `ω^i` are distinct) gives the inverse formula. ∎

**Why `x^N − 1` factors completely.** Over `F_p` with `N | p − 1`, the polynomial `x^N − 1` splits into `N` distinct linear factors `Π_{j=0}^{N−1}(x − ω^j)`, because the `N`-th roots of unity `ω^j` are exactly the `N` solutions of `y^N = 1` in the cyclic group `F_p^*` (of order `p − 1`, which has a unique subgroup of each order dividing it). Distinctness is what makes the evaluation map at the `ω^j` an isomorphism (the CRT for `F_p[x]/(x^N − 1) ≅ Π F_p[x]/(x − ω^j) ≅ F_p^N`), and that CRT *is* the convolution theorem. This is also why the NTT needs `N | p − 1`: without it, the roots collapse or leave `F_p`, and the factorization (hence the transform) fails.

**Theorem 9.3 (NTT existence condition).** A primitive `2^k`-th root of unity exists in `F_p` iff `2^k | p − 1`. Hence NTT-friendly primes have the form `p = c·2^k + 1`; e.g. `998244353 = 119·2^{23} + 1` supports transforms up to length `2^{23}`.

**Proof.** The multiplicative group `F_p^*` is cyclic of order `p − 1`; it contains an element of order `2^k` iff `2^k | p − 1`. A generator's `(p−1)/2^k`-th power then has order exactly `2^k`. ∎

**Evaluation–interpolation duality.** Theorem 4.1 (interpolation) and the convolution theorem are two sides of one coin: multiplication is cheap in the *point-value* representation (pointwise), so FFT/NTT multiply by transforming to point-values, multiplying, and transforming back. The `O(n²)` multipoint evaluation and interpolation of `middle.md` become `O(n log² n)` via the subproduct tree precisely because the DFT chooses *special* evaluation points (roots of unity) where evaluation is `O(n log n)` instead of `O(n²)`.

### 8.6 Generating functions and linear recurrences (a duality)

**Theorem 8.7 (Rational GF ⇔ linear recurrence).** A power series `A(x) = Σ a_n x^n` is the expansion of a rational function `P(x)/Q(x)` with `deg P < deg Q = d` and `Q(0) ≠ 0` iff the sequence `(a_n)` satisfies a constant-coefficient linear recurrence of order `d` with characteristic polynomial (the reversal of) `Q`.

**Proof sketch.** If `A = P/Q`, then `Q·A = P` as series; comparing coefficients of `x^n` for `n ≥ d` (where `P` has no terms) gives `Σ_{i=0}^{d} Q[i]·a_{n−i} = 0`, a linear recurrence. Conversely, a recurrence of order `d` makes `Q·A` a polynomial of degree `< d`, i.e. `A = (Q·A)/Q` is rational. ∎

**Consequence.** Computing the `n`-th term of a linear recurrence reduces to extracting `[x^n](P/Q)`, i.e. a series inverse `Q^{−1}` (Theorem 8.1) times `P`, truncated — `O(M(n))` to get all terms up to `n`, or `O(M(d) log n)` for a single far-out term via the Kitamasa / Cayley-Hamilton reduction (the polynomial-modular-exponentiation method, kin to sibling `11-matrix-exponentiation`). This is why series inverse is the workhorse not just for division but for recurrence evaluation: the matrix view and the rational-GF view are the same linear operator. Fibonacci's `1/(1 − x − x²)`, the Catalan GF, and tiling counts are all instances.

### 9.0 The modular-reduction homomorphism (why "reduce as you go" is valid)

**Proposition 9.1b.** Let `φ_p : Z[x] → F_p[x]` reduce each coefficient mod `p`. Then `φ_p` is a ring homomorphism: `φ_p(A + B) = φ_p(A) + φ_p(B)` and `φ_p(A·B) = φ_p(A)·φ_p(B)`.

**Proof.** Coefficient-wise reduction commutes with `+` (each coefficient sum reduces independently) and with `×`: each product coefficient `Σ_t A[i] B[j]` (sum over `i+j=k`) reduces term by term because `φ_p` is a ring homomorphism on the coefficient ring `Z → F_p`. ∎

**Corollary 9.1c (reduce as you go).** Interleaving `mod p` at every addition and multiplication of the schoolbook/Newton/NTT routines yields exactly the same residues as computing over `Z` and reducing once at the end. This is the formal license for the "reduce after each accumulation" implementation in `junior.md`, and it is what keeps coefficients bounded so nothing overflows.

**Corollary 9.1d (CRT pipeline correctness).** Running the same computation under several primes `p_1, …, p_m` and reconstructing each coefficient via CRT recovers the exact integer answer mod `Π p_i`, by Proposition 9.1b applied to each prime independently and the CRT isomorphism `Z/(Π p_i) ≅ Π Z/(p_i)`. This is the formal basis for the multi-prime exact-product pipeline of `senior.md` (sibling `06-crt` / Garner `17-garner-algorithm`).

### 9.1 Worked root-of-unity computation

For `p = 998244353 = 119·2^{23} + 1` with primitive root `g = 3`, find a primitive `8`-th root of unity (`N = 8 = 2^3`). By Theorem 9.3 it exists because `8 | p − 1`. Take `ω = g^{(p−1)/8} = 3^{(p−1)/8} mod p`. Then `ω` has order exactly `8`: `ω^8 ≡ 1` but no smaller power is `1`. The forward NTT of a length-8 (padded) coefficient array evaluates it at `ω^0, ω^1, …, ω^7`, and the inverse NTT uses `ω^{−1} = ω^7` followed by multiplication by `8^{−1} mod p`. For a product needing length `2^{20}`, the same construction gives `ω = 3^{(p−1)/2^{20}}`; the only constraint is `2^{20} ≤ 2^{23}`, which holds.

### 9.1b Worked NTT padding

To multiply `A` of degree 5 by `B` of degree 7 via NTT, the product has degree `12`, so it has `13` coefficients. The cyclic NTT computes convolution modulo `x^N − 1`; to make cyclic equal acyclic we need `N ≥ 13`, and `N` must be a power of two for the radix-2 transform, so `N = 16`. We zero-pad both arrays to length 16, forward-NTT (evaluate at the 16th roots of unity), multiply pointwise, inverse-NTT, and read the first 13 coefficients (indices 13, 14, 15 are guaranteed zero because the true product has degree 12 < 16). Choosing `N = 8` would be wrong: `8 < 13` causes coefficients `8..12` to wrap around (cyclic aliasing) and corrupt the answer. The rule — round **up** to the next power of two `≥ deg(A)+deg(B)+1` — is exactly Definition 9.1's "padding to length `≥ deg(A)+deg(B)+1`."

### 9.2 Worked convolution-theorem check (tiny)

Multiply `A = 1 + x` and `B = 1 + x` (so `A·B = 1 + 2x + x²`) via the convolution theorem with `N = 4` and a primitive 4th root `i` over `C` (illustrating the same mechanics NTT performs exactly over `F_p`). `DFT(A)` evaluates `A` at `1, i, −1, −i`: `(2, 1+i, 0, 1−i)`. Same for `B`. Pointwise square: `(4, (1+i)², 0, (1−i)²) = (4, 2i, 0, −2i)`. Inverse DFT recovers `(1, 2, 1, 0)` — coefficients `1 + 2x + x²`. The point: multiplication became a *pointwise* product in the evaluation domain, which is the entire source of the `O(n log n)` speedup; over `F_p` the roots of unity are exact, so no rounding occurs.

---

## 9.3 Quotient Rings and Finite Field Extensions

The division algorithm gives `F[x]` quotient rings `F[x]/(m(x))` that are the polynomial analogue of `Z/(n)`.

**Theorem 9.4 (Field extension).** `F_p[x]/(m(x))` is a field iff `m(x)` is irreducible over `F_p`. When `m` has degree `d`, this field has `p^d` elements and is the finite field `F_{p^d}` (Galois field `GF(p^d)`).

**Proof sketch.** The quotient is a field iff `(m)` is a maximal ideal iff `m` is irreducible (in the PID `F_p[x]`, maximal ideals are exactly those generated by irreducibles). The elements are the residues — polynomials of degree `< d` — of which there are `p^d`. Arithmetic is polynomial arithmetic reduced mod `m`; inverses exist by the extended Euclidean algorithm (Theorem 6.2): for `gcd(a, m) = 1`, the Bézout `u·a + v·m = 1` gives `a^{−1} ≡ u (mod m)`. ∎

**Consequence.** Every operation in this topic — multiply, division, GCD, even the NTT — is the engine behind finite-field arithmetic used in cryptography (AES's `GF(2^8)`), error-correcting codes (Reed-Solomon over `GF(2^8)` or a prime field), and the discrete-root machinery of sibling `13-primitive-root-discrete-root`. The polynomial `x` in the quotient acts as a root of `m`; computing `x^k mod m` by binary exponentiation (sibling `29-binary-exponentiation`) is exactly how one exponentiates in the extension field, and the Cayley-Hamilton/companion-matrix view connects it to linear recurrences (sibling `11-matrix-exponentiation`).

**Worked extension element.** In `F_2[x]/(x² + x + 1)` (the field `GF(4)`), the four elements are `0, 1, x, x+1`. Multiplication: `x·x = x² ≡ x + 1 (mod x² + x + 1)` (since `x² = −x − 1 ≡ x + 1` in characteristic 2). So `x` has multiplicative order 3: `x, x²= x+1, x³ = x·(x+1) = x² + x = (x+1) + x = 1`. The nonzero elements form a cyclic group of order 3, exactly `GF(4)^*`. This is polynomial arithmetic from this topic, reduced mod an irreducible — nothing more.

**Worked inverse in an extension.** Invert `x` in `F_2[x]/(x²+x+1)`. By extended Euclid on `(x, x²+x+1)`: `x²+x+1 = x·(x+1) + 1`, so `1 = (x²+x+1) − x·(x+1)`, giving `x·(x+1) ≡ −1 ≡ 1 (mod x²+x+1)`. Hence `x^{−1} = x + 1`. This is Theorem 6.2 (Bézout) used exactly as modular inversion in `Z/pZ` is used (sibling `07-extended-euclidean-modular-inverse`), but with polynomials — the operational heart of finite-field division.

**Corollary 9.5 (Horner is single-point division).** Evaluating `P(α)` (Theorem 3.1's remainder `r`) is the degree-1 case of the division algorithm, and the quotient's coefficients are the partial Horner accumulators. So the `junior.md` Horner loop and the `middle.md` long-division loop are the *same* algorithm at two scales — division by `(x − α)` versus division by an arbitrary `B`. This unifies "evaluate", "find a root's cofactor", and "deflate a known root" into one operation.

---

## 10. Complexity Landscape and Lower Bounds

Let `M(n)` be the cost of multiplying two degree-`n` polynomials over `F_p`.

| Multiply algorithm | `M(n)` |
|--------------------|--------|
| Schoolbook | `O(n²)` |
| Karatsuba (`15-divide-and-conquer/04-karatsuba`) | `O(n^{log₂ 3}) = O(n^{1.585})` |
| Toom-Cook (`k`-way) | `O(n^{1+ε})`, `ε → 0` |
| FFT / NTT (`15-divide-and-conquer/05-fft`, `15-ntt`) | `O(n log n)` |

**Reductions to `M(n)`:**

| Operation | Cost |
|-----------|------|
| Multiply | `M(n)` |
| Series inverse / log / exp / sqrt mod `x^n` | `O(M(n))` |
| Division with remainder | `O(M(n))` |
| Multipoint evaluation (`n` points) | `O(M(n) log n) = O(n log² n)` |
| Interpolation (`n` points) | `O(M(n) log n) = O(n log² n)` |
| GCD (Half-GCD) | `O(M(n) log n) = O(n log² n)` |

**Theorem 10.1 (Newton transfers `M`).** Inverse, division, log, exp, and sqrt are all `O(M(n))` because Newton's doubling makes the cost a geometric series dominated by the final `M(n)` step (Theorem 8.3). Thus improving the multiply primitive improves the whole tower simultaneously.

**Lower bounds.** Reading the `n+1` output coefficients of a product forces `Ω(n)`. The multiplicative complexity of polynomial multiplication over an infinite field is `Θ(n)` *bilinear* multiplications in the algebraic model (each product coefficient is a bilinear form), but the *additive* bookkeeping makes `O(n log n)` (FFT) the best known uniform bound; whether `O(n)` total operations is achievable in realistic models is tied to deep questions about the DFT. For practical degrees, schoolbook (small `n`), Karatsuba (medium), and NTT (large) are the operative choices, with the crossovers determined by constant factors, not asymptotics.

**Karatsuba recurrence (for completeness).** Splitting each degree-`n` operand into low/high halves `A = A_0 + A_1 x^{n/2}` and using the three-product identity
```
A·B = A_0 B_0 + x^{n/2}((A_0+A_1)(B_0+B_1) − A_0 B_0 − A_1 B_1) + x^n A_1 B_1
```
gives `T(n) = 3 T(n/2) + O(n)`, solving to `T(n) = O(n^{log₂ 3}) = O(n^{1.585})` by the Master Theorem (sibling `15-divide-and-conquer/03-master-theorem`). The three (not four) recursive products is the entire trick; Toom-Cook generalizes it to `2k−1` products from `k`-way splits, and the `k → ∞` limit is the FFT. The full treatment is sibling `15-divide-and-conquer/04-karatsuba`.

**Half-GCD.** The `O(M(n) log n)` polynomial GCD comes from the recursive Half-GCD, which computes the `2×2` matrix of partial quotients for the top half of the degrees, recurses, and combines — the polynomial analogue of the fast integer GCD. Its correctness rests on the same division-algorithm invariant (Section 6) applied to degree intervals.

### 10.1 Why the geometric series collapses

Theorem 10.1's claim that `Σ_{i=0}^{log n} M(2^i) = O(M(n))` deserves a line of justification. For any `M` with `M(2t) ≥ 2·M(t)` (super-additivity, true for `n²`, `n^{1.585}`, and `n log n`), the sum is dominated by its largest term:

```
Σ_{i=0}^{k} M(2^i) ≤ M(2^k)·Σ_{i=0}^{k} (1/2)^{k−i} = M(2^k)·(2 − 2^{−k}) < 2·M(n).
```

So all the doubling steps together cost less than twice the final step — the reason Newton iteration inherits the multiply's complexity with only a constant-factor overhead. This is the single most important complexity fact about the senior-level operations: there is no hidden `log n` from the iteration itself.

### 10.2 A worked complexity accounting

Computing `exp(B) mod x^n` from scratch: each Newton step at precision `t` does one `log` (which is one series inverse + one multiply + an `O(t)` integrate) plus one multiply. That is a constant number of length-`t` multiplies, `O(M(t))`. Summing over `t = 1, 2, …, n` gives `O(M(n))` by §10.1. With NTT, `M(n) = O(n log n)`, so `exp` is `O(n log n)`. The `exp` is the most expensive of the four series operations by a constant factor (it nests a `log`), but it is *asymptotically* identical — a clean illustration that the multiply primitive, not the operation, sets the complexity.

### 10.3 Practical crossovers

The asymptotic table hides constant factors that dominate at realistic sizes:

| Degree `n` | Fastest multiply in practice |
|------------|------------------------------|
| `≤ 64` | schoolbook |
| `64 – ~1000` | Karatsuba |
| `≥ ~1000` (mod a friendly prime) | NTT |

These crossovers depend on language, cache, and modular-reduction cost; they are measured, not derived. The theory says NTT wins eventually; the engineering says measure where "eventually" begins (the benchmark in [`tasks.md`](./tasks.md) does exactly this). For min-degree work the constant-factor-light schoolbook routinely beats both fancier algorithms.

### 10.4 Worked multipoint-evaluation reduction

Evaluate `P = x³ + 1` at points `{0, 1, 2, 3}` via the subproduct tree (the `O(n log² n)` method). Build the tree of `(x − x_i)`:

```
leaves:   (x−0), (x−1), (x−2), (x−3)
level 1:  (x)(x−1) = x²−x ,   (x−2)(x−3) = x²−5x+6
root:     (x²−x)(x²−5x+6) = x⁴ − 6x³ + 11x² − 6x   = Π(x − x_i)
```

Push `P` down: first `P mod (x²−x)` and `P mod (x²−5x+6)`, then those remainders mod the leaves. `P mod (x²−x)`: dividing `x³+1` by `x²−x` gives remainder `x²+1`, then `mod (x)` → `P(0)=1`, `mod (x−1)` → `P(1)=2`. Similarly the right branch yields `P(2)=9`, `P(3)=28`. Each leaf's surviving constant is the evaluation. The point: every node is one polynomial multiply or remainder (both `O(M(deg))`), there are `O(log n)` levels, and the per-level work is `O(M(n))` — total `O(M(n) log n) = O(n log² n)`, versus `O(n²)` for four separate Horner evaluations at large scale. Fast interpolation runs this tree in reverse, combining `y_i / M'(x_i)` upward.

---

## 11. Summary

The theory of this topic is unusually unified: a handful of theorems generate the entire algorithmic toolkit, and the same structures (field, convolution, Newton doubling) recur at every level. The bullets below state each pillar with its governing theorem; together they justify every algorithm in `junior.md`, `middle.md`, and `senior.md`.

- **`F[x]` is a Euclidean domain** (Theorem 2.1): unique quotient and remainder with `deg R < deg B`, valid precisely because `F` is a field (`lc(B)` invertible). This grounds division, GCD, and interpolation, and is the formal reason a **prime** modulus is required.
- **Factor theorem + degree bound** (Theorems 3.1–3.2): `(x−α)|P ⇔ P(α)=0`, and a degree-`n` polynomial has `≤ n` roots over a field — false over rings with zero divisors.
- **Interpolation** (Theorem 4.1): `n+1` distinct nodes determine a **unique** degree-`≤ n` polynomial; uniqueness is the degree bound applied to the difference, existence is the Lagrange construction (equivalently, Vandermonde nonsingularity). Newton's form (Theorem 5.2) gives the same polynomial with `O(n)` incremental updates.
- **Polynomial GCD** (Theorems 6.1–6.2): Euclid terminates because remainder degree strictly drops, is correct by the `gcd(A,B)=gcd(B,R)` invariant, and the extended version yields Bézout polynomials; `gcd(P,P')` detects repeated factors (Theorem 7.2).
- **Newton iteration** (Theorems 8.1–8.3): squares the `x`-adic error each step, doubling correct coefficients, so inverse/log/exp/sqrt mod `x^n` cost `O(M(n))` — the final full-length multiply dominates a geometric series.
- **Convolution / FFT-NTT duality** (Theorems 9.2–9.3): multiplication is pointwise in the evaluation representation at roots of unity; NTT needs `p = c·2^k+1`. Multipoint eval and interpolation drop to `O(n log² n)` by choosing special evaluation points.
- **Complexity** (Section 10): everything reduces to the multiply cost `M(n)`; schoolbook `O(n²)`, Karatsuba `O(n^{1.585})`, NTT `O(n log n)`, with division/series/eval/interp/GCD layered on top via Newton and subproduct trees.
- **Quotient rings** (Theorem 9.4): `F_p[x]/(m)` is a field iff `m` is irreducible, giving the finite field `F_{p^d}` — the algebraic home of finite-field cryptography and error-correcting codes, built entirely from the polynomial arithmetic of this topic.
- **Modular homomorphism** (Proposition 9.1b): coefficient reduction mod `p` commutes with `+` and `×`, licensing "reduce as you go" and the multi-prime CRT pipeline for exact integer products.

### The single unifying picture

Three facts generate everything in this topic:

1. **`F[x]` is a Euclidean domain** (because `F` is a field) — gives division, GCD, unique factorization, interpolation uniqueness.
2. **Convolution = multiplication = pointwise product after a DFT** — gives fast multiply (FFT/NTT) and, by reduction, fast everything else.
3. **Newton iteration doubles `x`-adic precision** — transfers the multiply cost to inverse/division/log/exp/sqrt with no asymptotic overhead.

Master these three and the entire complexity table below is a corollary: each row is "reduce to multiply, then apply Newton or a subproduct tree."

A fourth, meta-observation ties them together: the **evaluation homomorphism** (Definition 1.1b) is the hinge. Fact 1 (Euclidean structure) is about *coefficients*; fact 2 (convolution = pointwise product) is about *values*; the evaluation map translates between the two representations, and the FFT/NTT is just the fast bidirectional translator. Interpolation (coefficients ← values) and evaluation (values ← coefficients) are the inverse halves of one isomorphism, which is why fast interpolation and fast multipoint evaluation are transposes of the same subproduct tree.

### Complexity Cheat Table

| Task | Schoolbook | Fast (NTT-backed) |
|------|-----------|--------------------|
| Multiply | `O(n²)` | `O(n log n)` |
| Divide / remainder | `O(n²)` | `O(n log n)` |
| Series inverse/log/exp/sqrt | `O(n²)` | `O(n log n)` |
| Multipoint eval (`n` pts) | `O(n²)` | `O(n log² n)` |
| Interpolation (`n` pts) | `O(n²)` | `O(n log² n)` |
| GCD | `O(n²)` | `O(n log² n)` |

Every "fast" column entry is the schoolbook entry with `M(n)` swapped from `O(n²)` to `O(n log n)` (NTT), times at most one extra `log n` factor from a recursion tree. There is no separate algorithm to learn for each row — there is one multiply primitive and two composition patterns (Newton doubling; subproduct tree). That economy is the deepest practical takeaway of the theory.

### Closing notes

- **Field, not ring** (Sections 2–3): every theorem that "feels like" the integers (division, GCD, unique factorization, the root bound) is the field structure of `F_p` at work. Drop to a composite modulus and they all silently fail — the recurring practical hazard.
- **Two proofs of interpolation** (Section 4): the Lagrange-basis construction and the Vandermonde determinant are the same fact from two directions; either suffices, and both reduce uniqueness to the degree bound (Theorem 3.2).
- **Newton's free lunch** (Sections 8, 10.1): doubling precision costs the same (up to a constant) as the final full-length multiply — the geometric series collapses. This is why series operations are "as cheap as one multiply."
- **Everything is multiply** (Sections 9–10): convolution is the primitive; fast multiply (FFT/NTT) plus Newton and subproduct trees deliver every other operation at `O(M(n))` or `O(M(n) log n)`.
- **Quotient rings close the loop** (Section 9.3): the same arithmetic builds the finite fields `F_{p^d}` that power cryptography and coding theory, tying this topic to `13-primitive-root-discrete-root`, `14-tonelli-shanks`, and `29-binary-exponentiation`.
- **Generating-function duality** (Theorem 8.7): rational generating functions and linear recurrences are interchangeable encodings of one linear operator, so series inverse doubles as recurrence evaluation — the bridge to `11-matrix-exponentiation`.

Foundational references: any abstract algebra text (Dummit-Foote) for `F[x]` as a Euclidean/UFD; von zur Gathen & Gerhard, *Modern Computer Algebra*, for the division/Newton/Half-GCD complexity theory; Aho-Hopcroft-Ullman and CLRS Ch. 30 for FFT-based polynomial arithmetic. Sibling topics: `15-ntt`, `06-crt`, `17-garner-algorithm`, `13-primitive-root-discrete-root`, `14-tonelli-shanks`, `07-extended-euclidean-modular-inverse`, `01-gcd-lcm`, `29-binary-exponentiation`, and `15-divide-and-conquer/{04-karatsuba,05-fft}`.
