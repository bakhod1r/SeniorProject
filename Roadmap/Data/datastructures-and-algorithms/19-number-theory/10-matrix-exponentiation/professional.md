# Matrix Exponentiation for Linear Recurrences — Mathematical Foundations

## Table of Contents
1. Formal Definitions
2. The Recurrence-to-Matrix Bijection (Correctness)
3. The Companion Matrix and Its Characteristic Polynomial
4. Eigenvalues, Diagonalization, and Closed Forms
5. Binary Exponentiation: Correctness and Complexity
6. Modular Correctness and the CRT Pipeline
7. Augmentation for Inhomogeneous Terms (Proof)
8. Prefix Sums and Polynomial-in-n Forcing Terms
9. Cayley-Hamilton and the Kitamasa Speedup
10. Generating Functions and Rational Sequences
11. Fast Matrix Multiplication and Lower Bounds
12. Summary

---

> This document develops the theory rigorously, with every theorem anchored by a worked numeric example (Fibonacci recurs as the running thread). The single unifying idea: a constant-coefficient linear recurrence is the iteration of one fixed linear operator — the companion matrix — and every algorithm is a way to compute a high power of that operator efficiently.

## 1. Formal Definitions

**Definition 1.1 (Constant-coefficient linear recurrence).** A sequence `(f(n))_{n≥0}` over a commutative ring `R` (here `ℤ` or `ℤ_p`) satisfies an **order-`k` homogeneous constant-coefficient linear recurrence** if there exist constants `c_1, …, c_k ∈ R` with `c_k ≠ 0` such that

```
f(n) = c_1 f(n-1) + c_2 f(n-2) + … + c_k f(n-k)   for all n ≥ k,
```

with prescribed initial values `f(0), …, f(k-1)`. The constraint `c_k ≠ 0` ensures the recurrence is genuinely order-`k`; otherwise it collapses to a lower order. The coefficients live in `R`, so the same theory applies verbatim over `ℤ` (exact integer terms), `ℤ_p` (modular terms), `ℚ`, or any commutative ring.

**Definition 1.2 (State vector).** The **state** at index `n ≥ k-1` is the column

```
s(n) = ( f(n), f(n-1), …, f(n-k+1) )ᵀ ∈ R^k.
```

The state is the minimal information determining all future terms.

**Definition 1.3 (Companion / transition matrix).** The `k × k` **companion matrix** of the recurrence is

```
      [ c_1  c_2  c_3  …  c_{k-1}  c_k ]
      [  1    0    0   …    0       0  ]
M  =  [  0    1    0   …    0       0  ]
      [  …                          …  ]
      [  0    0    0   …    1       0  ]
```

— top row the coefficient vector `(c_1, …, c_k)`, the sub-diagonal all `1`, every other entry `0`. By convention `M^0 = I_k`, the `k × k` identity.

**Worked instance.** For Fibonacci (`k = 2`, `c_1 = c_2 = 1`), `M = [[1,1],[1,0]]`. For tribonacci (`k = 3`, `c_1 = c_2 = c_3 = 1`), `M = [[1,1,1],[1,0,0],[0,1,0]]`. For the order-4 recurrence `f(n) = 2 f(n-1) − f(n-3) + 3 f(n-4)`, the coefficient vector is `(2, 0, −1, 3)` (note the explicit `0` for the missing `f(n-2)` term), giving top row `(2, 0, −1, 3)` and the sub-diagonal of `1`s. Reading the recurrence into the top row, with zeros for absent terms, is mechanical and is the heart of the "build from the recipe" instruction at every lower level.

**Definition 1.4 (C-finite sequence).** A sequence is **C-finite** (constant-recursive) if it satisfies some order-`k` constant-coefficient linear recurrence. The C-finite sequences over a field form a ring under term-wise operations and are closed under shift, sum, Cauchy product, and Hadamard product (Section 10.2). Fibonacci, geometric sequences `r^n`, polynomial sequences `n^d`, and their sums/products are all C-finite; factorials `n!` and the primes are not.

**Definition 1.5 (Initial-state column, reversed).** Implementations build `s(k-1) = (f(k-1), f(k-2), …, f(0))ᵀ` — the newest term on top — because the companion matrix's top row produces the *next* (newest) term and the shift pushes older terms down. This reversal of the given initial-value list is the single most common off-by-one source in practice (senior level), and is fixed in the formal development by always writing `s(n)` with `f(n)` in position 0. Throughout this document "the term" means `f(n) = (s(n))_0`, the top coordinate of the state, recovered by `e_1ᵀ s(n)`.

**Notation conventions.** Throughout, `k` is the recurrence order, `n` the index, `p` a prime modulus, `χ_M(x)` the characteristic polynomial of `M`, `λ_r` its roots (the characteristic roots), `λ_max = max_r |λ_r|` the dominant root, `ω` the matrix-multiplication exponent, and `[P]` the Iverson bracket. "Homogeneous" means no additive forcing term; an inhomogeneous recurrence (`+b`, `+poly(n)`) is reduced to a homogeneous one of larger order by augmentation (Sections 7–8). We write `s(n)` for the state column and `e_1 = (1,0,…,0)ᵀ` for the first standard basis vector, so `f(n) = e_1ᵀ s(n)`.

**Scope and the central object.** The single object underlying every section is the **shift operator** on the solution space of the recurrence. The set of all sequences satisfying a fixed order-`k` recurrence is a `k`-dimensional vector space over `R` (a sequence is pinned by its `k` initial values), and the shift `E: (f(n)) ↦ (f(n+1))` is a linear endomorphism of that space whose matrix in the natural basis is the companion `M`. Everything that follows — the power formula (Section 2), the characteristic polynomial (Section 3), the spectral decomposition (Section 4), Cayley-Hamilton and Kitamasa (Section 9), and the rational generating function (Section 10) — is a different lens on this one operator. Keeping that in mind makes the proofs feel inevitable rather than ad hoc: they are all statements about powers of a single linear map.

---

## 2. The Recurrence-to-Matrix Bijection (Correctness)

The central correctness claim is that powering `M` advances the state, so reading the top entry of `M^{n-k+1} s(k-1)` yields `f(n)`.

**Theorem 2.1 (One-step transition).** For every `n ≥ k`, `M · s(n-1) = s(n)`.

**Proof.** Write `s(n-1) = (f(n-1), f(n-2), …, f(n-k))ᵀ`. Compute `M · s(n-1)` row by row.

*Row 0* (the coefficient row): its dot product with `s(n-1)` is
```
c_1 f(n-1) + c_2 f(n-2) + … + c_k f(n-k) = f(n)
```
by Definition 1.1 — exactly the recurrence.

*Row `i`* for `1 ≤ i ≤ k-1` (the shift rows): the only nonzero entry is `M[i][i-1] = 1`, so the dot product is `1 · (s(n-1))_{i-1} = (s(n-1))_{i-1}`. The `(i-1)`-th component of `s(n-1)` is `f(n-1-(i-1)) = f(n-i)`, which is precisely the `i`-th component of `s(n)` (namely `f(n-i)`).

Hence every component of `M · s(n-1)` matches `s(n)`. ∎

**Theorem 2.2 (Power formula / correctness).** For every `n ≥ k-1`,

```
s(n) = M^{n-(k-1)} · s(k-1),     and therefore     f(n) = e_1ᵀ M^{n-(k-1)} s(k-1).
```

**Proof (induction on `n`).** *Base `n = k-1`:* `M^0 = I`, so `s(k-1) = I · s(k-1)`. *Inductive step:* assume `s(n-1) = M^{(n-1)-(k-1)} s(k-1)`. By Theorem 2.1, `s(n) = M · s(n-1) = M · M^{(n-1)-(k-1)} s(k-1) = M^{n-(k-1)} s(k-1)`, using associativity of matrix multiplication. By induction the formula holds for all `n ≥ k-1`. The component statement follows since `f(n) = (s(n))_0 = e_1ᵀ s(n)`. ∎

**Corollary 2.3 (Bijection).** The map sending a recurrence `(c_1,…,c_k; f(0),…,f(k-1))` to the pair `(M, s(k-1))` is a bijection between order-`k` constant-coefficient recurrences and `(companion matrix, initial state)` pairs. The recurrence is recovered from `M`'s top row, the order from `M`'s dimension, and the initial values from `s(k-1)` (read in reverse). This is the precise sense in which "a linear recurrence *is* a matrix."

### 2.1 Worked Verification (Fibonacci)

`M = [[1,1],[1,0]]`, `s(1) = (F_1, F_0)ᵀ = (1,0)ᵀ`. Then `s(n) = M^{n-1} s(1)`. By induction `M^m = [[F_{m+1}, F_m],[F_m, F_{m-1}]]` (check: `M^1 = [[F_2,F_1],[F_1,F_0]] = [[1,1],[1,0]]` ✓; and `M^{m+1} = M^m M` reproduces the Fibonacci addition in each entry). Hence `s(n) = M^{n-1}(1,0)ᵀ = (F_n, F_{n-1})ᵀ`, and `f(n) = F_n = (M^{n-1})_{00} = F_n`. The brute-force loop `F_0=0, F_1=1, F_n=F_{n-1}+F_{n-2}` confirms every value, anchoring the inductive proof empirically.

### 2.2 The Multiplication Principle, Made Explicit

The one-step transition `M · s(n-1) = s(n)` is the matrix encoding of two elementary facts. First, the **superposition** fact: because the recurrence is *linear*, the new leading term `f(n)` is a fixed linear combination `Σ c_i f(n-i)` of the old window — no products of terms, no powers, no index-dependent coefficients. Second, the **shift** fact: the rest of the new state is the old state with its newest entry dropped and the just-computed `f(n)` prepended. The companion matrix splits these cleanly: the top row realizes superposition, the sub-diagonal realizes the shift. This is why *only* constant-coefficient linear recurrences admit a constant transition matrix — any nonlinearity (a product `f(n-1)f(n-2)`) or any index-dependence (a coefficient `n`) destroys the fixed-matrix structure, and the operator would have to change at every step.

Formally, the state space `R^k` carries the linear operator `L: R^k → R^k` defined by `L = M`, and the sequence is the orbit `{s(k-1), L s(k-1), L² s(k-1), …}` of the initial state under `L`. The `n`-th term is a *coordinate functional* `e_1ᵀ` applied to that orbit point. The entire theory is "iterate a linear operator and read a coordinate," and binary exponentiation is the statement that iterating a *fixed* linear operator `n` times is computing its `n`-th power, compressible to `O(log n)` applications by repeated squaring.

### 2.3 Uniqueness of the Transition Matrix

**Proposition 2.4.** The companion matrix `M` of Definition 1.3 is the *unique* matrix advancing the state for *all* valid initial conditions simultaneously.

**Proof.** Suppose `M'` also satisfies `M' s(n-1) = s(n)` for every sequence obeying the recurrence. As the initial values range over all of `R^k`, the states `s(k-1)` span `R^k` (the `k` standard basis vectors arise from the `k` unit initial conditions). A linear map is determined by its action on a spanning set, so `M' = M` on all of `R^k`, hence `M' = M`. ∎ This uniqueness is what makes Corollary 2.3's bijection well-defined: the recurrence does not merely *admit* a transition matrix, it determines exactly one.

---

## 3. The Companion Matrix and Its Characteristic Polynomial

**Theorem 3.1 (Characteristic polynomial of the companion matrix).** The characteristic polynomial of `M` is

```
χ_M(x) = det(xI - M) = x^k - c_1 x^{k-1} - c_2 x^{k-2} - … - c_{k-1} x - c_k.
```

**Proof sketch.** Expanding `det(xI − M)` along the last column (which has a single nonzero structure due to the sub-diagonal of `1`s) and inducting on `k` produces the alternating sum of the coefficients times powers of `x`. The companion matrix is constructed precisely so that its characteristic polynomial is the monic polynomial whose lower coefficients are `−c_i`; this is a standard determinant computation (cofactor expansion exploiting the `1`-sub-diagonal). ∎

**Significance.** The equation `χ_M(λ) = 0`, i.e. `λ^k = c_1 λ^{k-1} + … + c_k`, is exactly the **characteristic equation** of the recurrence. Thus the companion matrix encodes the same algebraic object as the recurrence's auxiliary polynomial. The roots `λ_r` are the **characteristic roots** that govern the sequence's growth and closed form (Section 4). For Fibonacci, `χ_M(x) = x² − x − 1`, roots `φ = (1+√5)/2` and `ψ = (1−√5)/2`.

**Trace and Newton's identities.** The trace `tr(M^n) = Σ_r λ_r^n` is the `n`-th power sum of the characteristic roots, computable from the coefficients via Newton's identities without ever finding the roots. This gives a second, independent route to a scalar derived from the sequence (e.g. the sum of the `k` "fundamental" solutions evaluated at `n`), and serves as a cross-check on a computed `M^n`: the trace of the result must equal the root power-sum predicted by Newton's identities applied to `(c_1, …, c_k)`. For Fibonacci, `tr(M^n) = F_{n+1} + F_{n-1} = L_n`, the `n`-th **Lucas number** — a clean invariant the implementation can assert.

**Minimal polynomial.** For a companion matrix the **minimal polynomial equals the characteristic polynomial** (the companion matrix is *nonderogatory*: a single Jordan block per eigenvalue), so `M` generates a `k`-dimensional algebra `span(I, M, …, M^{k-1})` and no smaller relation holds. This is what makes Kitamasa work at full order `k` (Section 9).

### 3.1 Worked Characteristic Polynomial

For the order-3 tribonacci recurrence `T(n) = T(n-1) + T(n-2) + T(n-3)`, the companion matrix is `M = [[1,1,1],[1,0,0],[0,1,0]]`. Its characteristic polynomial is `χ_M(x) = x³ − x² − x − 1`, the tribonacci auxiliary equation. The real root `λ_max ≈ 1.8393` (the *tribonacci constant*) governs the growth `T(n) ∼ C λ_max^n`; the other two roots are a complex-conjugate pair of modulus `< 1`, contributing decaying oscillatory corrections. Computing `χ_M` by `det(xI − M)` and expanding along the last column reproduces exactly the coefficient pattern `x^k − c_1 x^{k-1} − … − c_k`, with `c_1 = c_2 = c_3 = 1`. This is the concrete instance of Theorem 3.1, and the root structure (one dominant real root plus subdominant pairs) is typical of positive-coefficient recurrences via Perron-Frobenius applied to the companion matrix.

### 3.2 Why the Companion Form Is Canonical

Among all matrices similar to `M` (sharing its characteristic polynomial), the companion form is the **rational canonical form** for a single invariant factor. Any other transition encoding (e.g. a diagonal eigenbasis, or a different state ordering) is `S M S^{-1}` for some invertible `S`, and computes the same sequence after the corresponding change of coordinates. The companion form is preferred computationally because it is *integer* (no irrational eigenbasis), *sparse* (only `2k − 1` nonzero entries), and *directly readable* from the recurrence — no factoring of `χ_M` required. The senior-level "build from the recipe" instruction is exactly the construction of this canonical form.

### 3.3 Determinant and Invertibility

`det(M) = (−1)^{k-1} c_k`, read directly from the companion structure (expand along the first column, or note `det(M) = (−1)^k χ_M(0) = (−1)^k(−c_k)`). Hence `M` is invertible iff `c_k ≠ 0`, which Definition 1.1 assumes (`c_k ≠ 0` is what makes the recurrence genuinely order-`k` rather than a lower-order one in disguise). Invertibility matters when *running the recurrence backward* (computing `f(−1), f(−2), …` via `M^{-1}`) or when proving the powers `M^n` form a *group* rather than just a monoid — relevant to the eventual-periodicity arguments over finite rings `ℤ_p`, where `M ∈ GL_k(ℤ_p)` has finite multiplicative order dividing `|GL_k(ℤ_p)|`. For forward evaluation alone, invertibility is unneeded; the squaring algorithm uses only multiplication.

---

## 4. Eigenvalues, Diagonalization, and Closed Forms

**Setup.** If `χ_M` has `k` distinct roots `λ_1, …, λ_k`, then `M` is diagonalizable: `M = S Λ S^{-1}` with `Λ = diag(λ_1, …, λ_k)`. Then `M^n = S Λ^n S^{-1}`, and each sequence entry is a linear combination of `λ_r^n`:

```
f(n) = Σ_{r=1}^k α_r λ_r^n,
```

where the constants `α_r` are fixed by the `k` initial values (solve a Vandermonde system). This is the **general solution** of a linear recurrence.

**Theorem 4.1 (Dominant-root growth).** If there is a unique root `λ_max` of strictly maximal modulus with `α_{max} ≠ 0`, then

```
f(n) = α_{max} λ_max^n (1 + o(1))   as n → ∞,
```

so `f(n)` grows like `Θ(λ_max^n)`.

**Consequence.** Terms grow geometrically with ratio `λ_max`; if `|λ_max| > 1` they explode (mandating a modulus). For Fibonacci, `λ_max = φ`, and `F_n = (φ^n − ψ^n)/√5` (Binet's formula) is exactly the spectral decomposition with `α_1 = 1/√5, α_2 = −1/√5`.

**Perron-Frobenius for positive-coefficient recurrences.** When all coefficients `c_i ≥ 0` and the recurrence is "primitive" (gcd of the indices with `c_i > 0` is 1), the companion matrix is a non-negative primitive matrix, so by the **Perron-Frobenius theorem** it has a *unique* eigenvalue `λ_max > 0` of strictly maximal modulus, with positive eigenvector. This guarantees clean dominant-root asymptotics: `f(n) = α_{max} λ_max^n (1 + o(1))` with `α_{max} > 0` whenever the initial conditions are non-negative and not all zero. Fibonacci (`λ_max = φ`), tribonacci (`λ_max ≈ 1.839`), and Pell (`λ_max = 1 + √2 ≈ 2.414`) are all instances. The theorem fails for recurrences with negative coefficients, where complex dominant roots of equal modulus can produce *oscillating* (non-monotone) growth — a reason the geometric-growth sanity check (senior level) must allow for sign changes when coefficients are negative.

**Repeated roots.** If `λ_r` has multiplicity `m`, the corresponding terms are `(β_0 + β_1 n + … + β_{m-1} n^{m-1}) λ_r^n` — polynomial-in-`n` factors appear. The matrix is then not diagonalizable but is similar to its Jordan form; `M^n` still has the Jordan-block closed form, and the recurrence's general solution carries the polynomial coefficients. The matrix-power algorithm needs none of this — it computes `M^n` directly regardless of diagonalizability — but the spectral form explains the growth.

**Exactness caveat.** The roots `λ_r` are algebraic numbers, typically irrational (e.g. `φ`). Evaluating the closed form in floating point does **not** yield an exact integer, and reducing an irrational mod `p` is meaningless. The spectral form is for asymptotics; exact terms require integer matrix exponentiation over `ℤ_p` (Section 6). This is the formal justification for the senior-level rule "never use Binet for exact answers."

### 4.1 Worked Spectral Example (Fibonacci / Binet)

The Fibonacci matrix `M = [[1,1],[1,0]]` has `χ_M(x) = x² − x − 1`, roots `φ = (1+√5)/2 ≈ 1.618` and `ψ = (1−√5)/2 ≈ −0.618`. Diagonalizing, `M = S diag(φ, ψ) S^{-1}`, and reading off the top-right entry of `M^{n-1}` gives

```
F_n = (φ^n − ψ^n) / √5      (Binet's formula).
```

Since `|ψ| < 1`, `ψ^n → 0`, so `F_n = round(φ^n / √5)` for `n ≥ 1` — the dominant-root asymptotic of Theorem 4.1 with `λ_max = φ`. Two lessons crystallize here. First, `√5` and `φ` are irrational, so a `double` evaluation accumulates error and fails past `n ≈ 79` (where `F_n` exceeds `2^53`); to get `F_{10^18} mod p` you *must* power `M` over `ℤ_p`. Second, the growth rate `log φ ≈ 0.481` nats/step (or `0.694` bits/step) tells you `F_n` has about `0.694 n` bits — the exact size estimate the CRT pipeline (Section 6) needs to choose its prime count.

### 4.2 Repeated-Root Closed Form (Worked)

Consider `f(n) = 4 f(n-1) − 4 f(n-2)`, with `χ_M(x) = x² − 4x + 4 = (x − 2)²` — a *double* root `λ = 2`. The matrix `M = [[4, −4],[1, 0]]` is not diagonalizable; its Jordan form is `[[2, 1],[0, 2]]`. The general solution carries a polynomial factor: `f(n) = (α + β n) 2^n`. With initial values `f(0) = 1, f(1) = 4`, solving gives `α = 1, β = 1`, so `f(n) = (1 + n) 2^n`. The matrix-power algorithm computes this with no special handling — it powers `M` directly regardless of the Jordan structure — but the closed form explains the linear-times-geometric growth. Repeated roots are exactly when the simple `Σ α_r λ_r^n` formula needs polynomial coefficients, yet the algorithm is indifferent.

### 4.3 Why the Algorithm Beats the Closed Form in Practice

The spectral closed form `f(n) = Σ_r α_r λ_r^n` looks like an `O(1)`-per-term oracle, but it is a *trap* for exact computation on three counts. First, the roots `λ_r` require factoring `χ_M`, which over `ℚ` may be impossible in closed radicals for `k ≥ 5` (Abel-Ruffini), and over `ℝ` yields irrationals. Second, even when roots are known, evaluating `λ_r^n` exactly mod `p` requires the roots to *exist* mod `p` (they may live only in an extension field `𝔽_{p^d}`), reintroducing the matrix/polynomial machinery. Third, the coefficients `α_r` come from a Vandermonde solve that is ill-conditioned in floating point. The integer matrix power sidesteps all three: it never factors, never leaves `ℤ_p`, and never rounds. This is the rigorous backing for the universal advice "compute the term, do not evaluate the closed form" — the closed form is for *understanding* growth, the matrix power is for *computing* values.

---

### 4.4 Growth-Rate Sanity Checks in Practice

A computed term `f(n) mod p` is opaque, but its *magnitude* (before reduction) obeys `log f(n) ≈ n log λ_max + log α_max`. This gives a cheap consistency check usable even in the modular world: compute a few small unreduced terms, fit `log f(n)` against `n` to estimate `log λ_max`, and confirm the slope matches the dominant root of `χ_M` (computable from the coefficients without factoring, via the power-iteration `M v / |M v|`). A mismatch flags a transcription error in the coefficients or the matrix. For Fibonacci the slope is `log φ ≈ 0.481`; for Pell, `log(1+√2) ≈ 0.881`. This turns the spectral theory into a debugging tool, not merely an asymptotic curiosity.

## 5. Binary Exponentiation: Correctness and Complexity

**Algorithm.**
```
MAT-POW(M, n):                  # over a commutative ring R
  R := I                         # multiplicative identity
  while n > 0:
    if n & 1 == 1: R := R · M
    M := M · M
    n := n >> 1
  return R
```

**Theorem 5.1 (Correctness).** `MAT-POW(M, n)` returns `M^n`.

**Proof (loop invariant).** Write `n = Σ_{b∈B} 2^b` where `B` is the set of set-bit positions. Let `M_s` be the value of variable `M` after `s` squarings; by induction `M_s = M^{2^s}` (since `M^{2^s} · M^{2^s} = M^{2^{s+1}}`). Invariant: before processing bit `s`, `R = M^{Σ_{b∈B, b<s} 2^b}` (product of powers for already-consumed set bits). Initially `R = I = M^0` (empty product). When bit `s` is set, multiplying `R` by `M_s = M^{2^s}` extends the exponent by `2^s`, valid because powers of one matrix commute: `M^a · M^b = M^{a+b}` (both are polynomials in the single matrix `M`, and any two polynomials in `M` commute). After all `⌊log₂ n⌋ + 1` bits, `R = M^{Σ_{b∈B} 2^b} = M^n`. ∎

**Theorem 5.2 (Complexity).** Over a `k × k` matrix with `O(1)` ring operations, `MAT-POW` performs at most `2⌊log₂ n⌋ + 2` matrix multiplications, hence `O(k³ log n)` time (schoolbook multiply) and `O(k²)` space.

**Proof.** The loop runs `⌊log₂ n⌋ + 1` times; each iteration does one squaring and at most one conditional multiply, so at most `2(⌊log₂ n⌋ + 1)` multiplies. Each schoolbook `k × k` multiply costs `Θ(k³)` ring operations, each `O(1)` over `ℤ_p`. Total `O(k³ log n)`; space is `O(1)` matrices of size `k²`. ∎

**Remark (essential vs total multiplies).** The "essential" multiplies (those that actually build `M^n`) number `⌊log₂ n⌋ + popcount(n)`: one squaring per bit position below the top, plus one conditional multiply per set bit. The final squaring (when the last bit is processed) is wasted work and can be elided by a left-to-right variant (Section 5.3) or by guarding the squaring with `if n > 1`. For `n = 10^18 ≈ 2^60`, that is about `60 + 30 = 90` matrix multiplies in the worst case — utterly negligible compared to the `k³` cost of each, confirming that the `log n` factor is never the bottleneck.

**Remark (the `O(1)` arithmetic assumption).** Theorem 5.2 charges each ring operation as `O(1)`, valid over `ℤ_p` for fixed-width `p`. If instead the exact non-modular term is wanted, each entry of `M^n` has `Θ(n log λ_max)` bits, big-integer multiplication is `Θ(M(n))` rather than `O(1)`, and the `log n` advantage erodes — the total becomes `Θ(k³ M(n) log n)` with `M` the integer-multiplication cost. This is the formal reason exact-term problems either specify a modulus (restoring `O(1)` arithmetic) or accept the CRT pipeline's per-prime modular runs (Section 6). The clean `O(k³ log n)` bound is a statement about modular arithmetic specifically.

**Why powers of one matrix commute (in detail).** The invariant's step "multiplying `R` by `M^{2^s}` adds `2^s` to the exponent" relies on `M^a M^b = M^{a+b}`. General matrices do *not* commute, so this needs justification: `M^a` and `M^b` are both polynomials in the *single* matrix `M` (`M^a = M·M⋯M`, `a` factors), and any two polynomials in the same matrix commute because matrix multiplication of identical factors is associative and the factors are all `M`. The exponents therefore simply add, regardless of whether `M` commutes with *other* matrices. This is the precise reason binary exponentiation — which multiplies various powers of the *same* `M` — is valid even though matrix multiplication is non-commutative in general.

### 5.1 Worked Trace (`n = 13`)

`13 = 1101₂` (bits low→high: `1,0,1,1`):

```
n=13 (1101): bit0=1 → R = I·M = M^1 ;  M := M^2
n=6  (110):  bit0=0 → skip          ;  M := M^4
n=3  (11):   bit0=1 → R = M^1·M^4 = M^5 ; M := M^8
n=1  (1):    bit0=1 → R = M^5·M^8 = M^{13} ; M := M^{16}
n=0: stop. R = M^{13}.   ✓ (8 + 4 + 1 = 13)
```

Four squarings, three conditional multiplies — consistent with `⌊log₂ 13⌋ + popcount(13) = 3 + 3 = 6` essential multiplies plus the final unused square, within the `≤ 2⌊log₂ n⌋ + 2` bound.

### 5.2 Addition-Chain Optimality

Binary exponentiation realizes the **binary addition chain** for `n`: a sequence `1 = a_0, a_1, …, a_L = n` where each `a_i` is a sum of two earlier entries (here, a doubling or a doubling-plus-one). Its length is `L = ⌊log₂ n⌋ + popcount(n) − 1`, which is within a factor of 2 of the *shortest* addition chain. Finding the shortest chain is NP-hard in general, but for a *fixed* `n` reused across many matrices (e.g. a service that always evaluates the same horizon), precomputing a windowed or sliding-window exponentiation chain shaves a small constant factor by batching consecutive set bits. For the typical single-shot evaluation, plain binary is the right default; the matrix multiply, not the chain length, dominates the cost.

### 5.3 Left-to-Right vs Right-to-Left

The algorithm above scans `n`'s bits right-to-left (least significant first), maintaining a separate `base = M^{2^s}` and accumulator. An equivalent **left-to-right** variant scans most-significant first: `R := I; for each bit b of n (high→low): R := R²; if b == 1: R := R · M`. It uses one matrix register instead of two and is often preferred when squaring is cheaper than holding a second matrix. Both perform `Θ(log n)` multiplies and produce identical results by Theorem 5.1; the right-to-left form is shown because it parallels the scalar fast-power most students already know, and because the explicit `base` makes the squaring ladder (and the animation) easy to visualize.

---

## 6. Modular Correctness and the CRT Pipeline

**Proposition 6.1.** Let `φ_p : ℤ → ℤ_p` be reduction mod `p`. It is a ring homomorphism, and applying it entrywise commutes with matrix multiplication: `φ_p(A · B) = φ_p(A) · φ_p(B)` in `Mat_k(ℤ_p)`.

**Proof.** `φ_p(x+y) = φ_p(x)+φ_p(y)` and `φ_p(xy) = φ_p(x)φ_p(y)` by definition of `ℤ_p`. Each entry `(AB)[i][j] = Σ_t A[i][t]B[t][j]` is a sum of products; applying `φ_p` term by term and using the homomorphism gives `(φ_p(A)φ_p(B))[i][j]`. ∎

**Corollary 6.2.** `φ_p(M^n) = φ_p(M)^n`. Reducing inputs mod `p`, running the *entire* binary exponentiation over `ℤ_p`, and reading the result yields exactly the true term reduced mod `p`. Reductions may be interleaved at every operation without affecting the result — the basis for "reduce in the inner loop."

**Proof.** By Proposition 6.1, `φ_p` commutes with matrix multiplication; by induction on the structure of binary exponentiation (each step is a matrix multiply), `φ_p(M^n) = φ_p(M)^n`. The bottom row `(s(k-1))` and the read-out `e_1ᵀ` are linear, and `φ_p` commutes with linear combinations, so `φ_p(f(n)) = e_1ᵀ φ_p(M)^{n-(k-1)} φ_p(s(k-1))` — the computation done entirely in `ℤ_p` returns `f(n) mod p` exactly. ∎

**CRT for exact large values.** When the exact (non-modular) term exceeds one prime's range, run the matrix power independently mod coprime primes `p_1, …, p_m` and reconstruct the value mod `∏ p_i` via the Chinese Remainder Theorem. Each prime is an independent job (Section 4 of `senior.md`). The number of primes needed is `⌈log₂ f(n) / log₂ p⌉ ≈ ⌈n log₂ λ_max / log₂ p⌉`, computable from the dominant root (Section 4).

### 6.1 Correctness of Interleaved Reduction

**Proposition 6.3.** Reducing mod `p` at *any* subset of the arithmetic operations during `MAT-POW`, rather than only at the end, yields the identical residue.

**Proof.** `ℤ_p` is a ring and the natural map `φ_p` is a ring homomorphism (Proposition 6.1). Binary exponentiation computes a fixed polynomial expression in the matrix entries (a composition of `+` and `×`). Because `φ_p` commutes with both operations, it commutes with any composition of them, so reducing an intermediate result is equivalent to reducing its preimage — the final residue is invariant under where the reductions are inserted. ∎ This is the theoretical license for the "reduce in the inner loop" implementation: it changes *when* but never *what* is computed mod `p`, while keeping every intermediate within machine-word range.

### 6.2 The CRT Reconstruction Map

Given residues `r_i = f(n) mod p_i` for pairwise-coprime primes `p_1, …, p_m`, the Chinese Remainder Theorem provides a ring isomorphism `ℤ_{P} ≅ ℤ_{p_1} × … × ℤ_{p_m}` with `P = ∏ p_i`, so the system has a *unique* solution `x ∈ [0, P)`. Reconstruction is `x = Σ_i r_i M_i y_i mod P` where `M_i = P / p_i` and `y_i = M_i^{-1} mod p_i`. If the true (non-modular) `f(n)` satisfies `0 ≤ f(n) < P`, then `x = f(n)` exactly. The growth bound `f(n) < C λ_max^n` (Section 4) determines how large `P` — hence how many primes — is required, closing the loop between spectral analysis (sizing) and modular computation (evaluation). For sequences with possibly-negative terms, recover the *signed* representative `x − P` when `x > P/2`.

### 6.3 Worked CRT Reconstruction

Suppose `f(n) = 1000000123` exactly, and we work mod `p_1 = 10^9 + 7` and `p_2 = 10^9 + 9`. The modular runs return `r_1 = f(n) mod p_1 = 116` and `r_2 = f(n) mod p_2 = 114`. Reconstruct: `inv = p_1^{-1} mod p_2`, `t = ((r_2 − r_1)·inv) mod p_2`, `x = r_1 + p_1·t`. Since the true value `1000000123 < p_1 p_2 ≈ 10^{18}`, the reconstruction yields exactly `1000000123`. The key invariant: as long as `0 ≤ f(n) < ∏ p_i`, the CRT output equals the integer term, not merely a residue. The growth bound (Section 4) guarantees enough primes are used: `F_n < φ^n`, so `n log₂ φ` bits, and `⌈n log₂ φ / 30⌉ + 1` thirty-bit primes suffice — each an independent matrix-exponentiation job, so the whole exact computation parallelizes perfectly across primes.

---

## 7. Augmentation for Inhomogeneous Terms (Proof)

An **inhomogeneous** recurrence adds a forcing term: `f(n) = c_1 f(n-1) + … + c_k f(n-k) + b` for a constant `b`. The companion matrix alone cannot produce `b`. Augmentation embeds it into a *homogeneous* recurrence of order `k+1`.

**Theorem 7.1 (Constant augmentation).** Let `f(n) = c_1 f(n-1) + … + c_k f(n-k) + b`. Define the augmented state `ŝ(n) = (f(n), f(n-1), …, f(n-k+1), 1)ᵀ ∈ R^{k+1}` and the augmented matrix

```
       [ c_1  c_2  …  c_k  b ]
       [  1    0   …   0   0 ]
M̂  =  [  0    1   …   0   0 ]
       [  …                  ]
       [  0    0   …   1   0 ]    (k+1)×(k+1)
       [  0    0   …   0   1 ]    <- the constant row (self-loop)
```

Then `M̂ · ŝ(n-1) = ŝ(n)` for all `n ≥ k`, hence `f(n) = e_1ᵀ M̂^{n-(k-1)} ŝ(k-1)`.

**Proof.** *Last row* `(0,…,0,1)` dotted with `ŝ(n-1)` gives `1`, preserving the constant slot: `(ŝ(n))_{k} = 1` ✓. *Top row* `(c_1,…,c_k,b)` dotted with `ŝ(n-1) = (f(n-1),…,f(n-k),1)ᵀ` gives `c_1 f(n-1) + … + c_k f(n-k) + b·1 = f(n)` ✓ — the inhomogeneous recurrence, with the `b` supplied by multiplying the constant slot. *Shift rows* `1..k-1` behave exactly as in Theorem 2.1, copying `f(n-i)` into slot `i`. Every component matches `ŝ(n)`. ∎

**Interpretation.** The constant `b` becomes a coefficient on a "virtual" state component pinned to `1` by its self-loop. This is the algebraic content of the junior/middle "augment the matrix" instruction: the extra dimension carries the inhomogeneity, turning an order-`k` inhomogeneous recurrence into an order-`(k+1)` homogeneous one with characteristic polynomial `(x-1) · χ_M(x)` — the extra root `λ = 1` corresponds to the constant particular solution.

### 7.1 Worked Augmentation

Take `f(n) = 2 f(n-1) + 3`, `f(0) = 0`, so the sequence is `0, 3, 9, 21, 45, …` (each `2·prev + 3`). The augmented state is `ŝ(n) = (f(n), 1)ᵀ` and

```
M̂ = [ 2  3 ]      ŝ(0) = (0, 1)ᵀ.
    [ 0  1 ]
```

Then `M̂² = [[4, 9],[0, 1]]`, and `M̂² ŝ(0) = (9, 1)ᵀ`, giving `f(2) = 9` ✓. The characteristic polynomial is `(x − 2)(x − 1) = x² − 3x + 2`: the root `2` is the homogeneous growth and the root `1` is the constant particular solution. The closed form is `f(n) = 3·2^n − 3` (check: `3·1 − 3 = 0`, `3·2 − 3 = 3`, `3·4 − 3 = 9`), exhibiting the two roots' contributions. This worked case is the order-`k = 1` instance of Theorem 7.1, and the general inhomogeneous-to-homogeneous lift follows the same self-loop construction. Note how the closed form `3·2^n − 3` separates cleanly into a *homogeneous* part `3·2^n` (the `λ = 2` mode) and a *particular* part `−3` (the `λ = 1` constant mode) — the two roots of the augmented characteristic polynomial, each with its own constant fixed by the single initial value `f(0) = 0`. The augmentation made the inhomogeneous problem homogeneous, and the spectral decomposition then reads off both modes automatically.

### 7.2 General Inhomogeneous Lift

More generally, if the forcing term `g(n)` itself satisfies an order-`d` homogeneous recurrence with characteristic polynomial `ψ(x)`, the inhomogeneous recurrence `f(n) = Σ c_i f(n-i) + g(n)` lifts to a homogeneous recurrence of order `k + d` whose characteristic polynomial is `χ_M(x) · ψ(x)` (or their lcm, when the polynomials share roots — then the shared root's multiplicity adds, producing the polynomial-times-geometric *resonance* terms familiar from differential equations). The augmented matrix is block-triangular: the `g`-block evolves `g` independently, and a coupling row injects `g(n)` into `f(n)`. Constants are `d = 0` with `ψ(x) = x − 1`; a linear forcing `g(n) = n` is `d = 1` resonance with `ψ(x) = (x − 1)²` shared against any `f` having `λ = 1`.

**Resonance worked example.** Consider `f(n) = f(n-1) + 1` (a constant forcing `g = 1` against a recurrence whose homogeneous part `f(n) = f(n-1)` already has root `λ = 1`). The homogeneous characteristic polynomial is `x − 1` and the forcing's is `x − 1`; they *share* the root `1`, so the combined characteristic polynomial is `(x − 1)²`, not `(x − 1)(x − 1)` as distinct factors. The double root produces a *polynomial* particular solution: `f(n) = f(0) + n` (linear in `n`), the discrete analogue of resonance in a forced oscillator at its natural frequency. The augmented matrix `[[1,1],[0,1]]` (a Jordan block for eigenvalue 1) computes exactly this, and `M̂^n = [[1, n],[0, 1]]`, so `f(n) = f(0) + n` falls out — the off-diagonal `n` is the resonance signature.

---

## 8. Prefix Sums and Polynomial-in-n Forcing Terms

**Theorem 8.1 (Prefix-sum augmentation).** Let `f` satisfy an order-`k` homogeneous recurrence and define `S(n) = Σ_{m=0}^n f(m)`. Then `(S(n), f(n), …, f(n-k+1))ᵀ` satisfies an order-`(k+1)` homogeneous recurrence whose matrix prepends a row `(1, c_1, …, c_k)` and a leading column `e_1` to the companion block.

**Proof.** `S(n) = S(n-1) + f(n) = S(n-1) + c_1 f(n-1) + … + c_k f(n-k)`, which is the dot product of `(1, c_1, …, c_k)` with `(S(n-1), f(n-1), …, f(n-k))ᵀ`. The remaining rows are the unchanged companion block for `f`. Hence one matrix advances both `S` and the `f`-window simultaneously. ∎

**Polynomial forcing terms.** A forcing term that is a polynomial `q(n)` of degree `d` (e.g. `f(n) = f(n-1) + n²`) is handled by augmenting with the **states of `q`**: since `q(n)` itself satisfies the order-`(d+1)` recurrence with characteristic polynomial `(x-1)^{d+1}` (finite differences vanish after `d+1` steps), append `d+1` extra components carrying `1, n, n², …, n^d` (or a binomial basis). The forcing term then becomes a homogeneous linear combination of state components, and the whole system is a single companion-style matrix of order `k + d + 1`. Constants are the `d = 0` special case (Section 7).

**General principle.** Any forcing term that *itself* satisfies a constant-coefficient linear recurrence can be folded into the state, because the product/sum of two C-finite (linearly recurrent) sequences is again C-finite. Augmentation is the constructive proof: the augmented matrix's characteristic polynomial is the lcm of the two characteristic polynomials.

### 8.1 Worked Prefix-Sum Augmentation

Take Fibonacci `f` and `S(n) = Σ_{m=0}^n f(m)`. With state `(S(n), f(n), f(n-1))ᵀ` and Fibonacci coefficients `c_1 = c_2 = 1`:

```
M̂ = [ 1  1  1 ]      ŝ(1) = (S(1), f(1), f(0))ᵀ = (1, 1, 0)ᵀ
    [ 0  1  1 ]
    [ 0  1  0 ]
```

The top row `(1, 1, 1)` computes `S(n) = S(n-1) + f(n-1) + f(n-2) = S(n-1) + f(n)`; the lower block is the ordinary Fibonacci companion. Powering: `M̂ ŝ(1) = (1·1 + 1·1 + 1·0, 0 + 1 + 0, 0 + 1·1 + 0)ᵀ = (2, 1, 1)ᵀ`, so `S(2) = 2 = f(0)+f(1)+f(2) = 0+1+1` ✓. One `3×3` power simultaneously yields the term and its running sum — the order-`(k+1)` lift of Theorem 8.1, with the extra eigenvalue `λ = 1` accounting for the accumulating sum (a constant-rate inhomogeneity in the sum's own recurrence).

### 8.2 Polynomial Forcing as Finite Differences

A forcing term `q(n) = n^d` satisfies the recurrence with characteristic polynomial `(x − 1)^{d+1}`, because the `(d+1)`-th finite difference of a degree-`d` polynomial vanishes: `Δ^{d+1} q = 0`, and `Δ = E − 1` where `E` is the shift, so `(E − 1)^{d+1} q = 0`. The augmenting block is therefore a single Jordan block of size `d+1` for eigenvalue `1`. Embedding `(1, n, n², …, n^d)` (or the binomial basis `(C(n,0), C(n,1), …, C(n,d))`, which the shift acts on by Pascal's rule, giving a cleaner integer matrix) as extra state lets any polynomial forcing term be written as a homogeneous linear combination. This is the constructive form of "polynomial sequences are C-finite of order `d+1`," and it generalizes the constant case (`d = 0`, block size 1, the self-loop of Section 7).

---

## 9. Cayley-Hamilton and the Kitamasa Speedup

**Theorem 9.1 (Cayley-Hamilton).** Every `k × k` matrix `M` satisfies its own characteristic polynomial: `χ_M(M) = 0`.

**Consequence.** `M^k = c_1 M^{k-1} + … + c_k I` (reading off `χ_M`), so `M^n` for any `n` is a linear combination of `I, M, …, M^{k-1}` — a degree-`<k` polynomial in `M`. Therefore `M^n` is determined by `k` scalars, not `k²` entries.

**Theorem 9.2 (Kitamasa complexity).** The `n`-th term of an order-`k` recurrence can be computed in `O(k² log n)` (schoolbook polynomial multiply) or `O(k log k log n)` (FFT/NTT multiply), versus `O(k³ log n)` for the matrix power.

**Proof idea.** Work in the quotient ring `R = ℤ_p[x]/(χ_M(x))`, where the element `x` acts as `M` (the shift). Compute `x^n mod χ_M(x)` by *polynomial* binary exponentiation:

```
KITAMASA(χ, n):                       # χ has degree k
  P := 1
  base := x
  while n > 0:
    if n & 1: P := (P · base) mod χ
    base := (base · base) mod χ
    n := n >> 1
  return P                            # polynomial of degree < k
```

Each `·` is a degree-`<k` product (`O(k²)` schoolbook, `O(k log k)` with NTT) followed by a `mod χ` division (same cost), over `O(log n)` iterations: `O(k² log n)`. If `x^n ≡ Σ_{m=0}^{k-1} a_m x^m (mod χ)`, then `f(n) = Σ_m a_m f(m)`, an `O(k)` dot product against the known initial terms. Correctness: `χ_M(M) = 0` means polynomial identities mod `χ_M` translate exactly to matrix identities, so `(x^n mod χ_M)(M) = M^n` and applying to `s(k-1)` recovers `f(n)`. ∎

**When each wins.** The crossover is `k ≈ 64`: below it, the matrix power's cache behavior and simplicity dominate; above it, the `k`-factor saving makes Kitamasa decisive. The matrix and the characteristic polynomial are two encodings of one linear operator (Section 3) — Kitamasa uses the polynomial encoding to drop a factor of `k` when only a single term is wanted.

**Equivalence of the two encodings.** Theorem 9.2 and the matrix power compute the *same* number `f(n)`; they differ only in representation. The matrix view tracks `M^n` as a `k × k` array (`k²` scalars); the Kitamasa view tracks `x^n mod χ_M` as a degree-`<k` polynomial (`k` scalars). Cayley-Hamilton is the bridge: it says these `k` polynomial coefficients already determine the full `k × k` matrix action on the orbit, so carrying `k²` scalars is redundant when only the single term `f(n) = e_1ᵀ M^n s(k-1)` is wanted. The `k`-factor saving is exactly the ratio `k² / k³ = 1/k` of carried data per squaring.

### 9.0 Eventual Periodicity over a Finite Ring

Over `ℤ_p` the sequence `(f(n) mod p)` is **eventually periodic** because the state `s(n) ∈ ℤ_p^k` takes only `p^k` values, so by pigeonhole some state repeats and (since `M` is deterministic) the sequence cycles from there. If `M` is invertible (`c_k ≢ 0 mod p`), the period is *pure* (no pre-period) and divides the order of `M` in `GL_k(ℤ_p)`; for Fibonacci mod `p` this period is the **Pisano period** `π(p)`, with `π(p) ≤ 6p`. This has a practical payoff: for a batch of queries with indices `n_i`, reducing each `n_i mod π(p)` collapses astronomically large indices to a small range, after which a single precomputed table of one period answers all queries in `O(1)` each. The matrix view makes the period's existence obvious (finite state space) and its divisor structure computable (order of `M` in the matrix group).

### 9.1 Worked Kitamasa (Fibonacci)

For Fibonacci, `χ(x) = x² − x − 1`, so `x² ≡ x + 1 (mod χ)`. Compute `x^{10} mod χ` by repeated squaring with reduction:

```
x²  ≡ x + 1
x⁴  = (x+1)² = x² + 2x + 1 ≡ (x+1) + 2x + 1 = 3x + 2
x⁸  = (3x+2)² = 9x² + 12x + 4 ≡ 9(x+1) + 12x + 4 = 21x + 13
x^{10} = x⁸ · x² ≡ (21x+13)(x+1) = 21x² + 34x + 13 ≡ 21(x+1) + 34x + 13 = 55x + 34
```

So `x^{10} ≡ 55x + 34 (mod χ)`, meaning `f(10) = 55·f(1) + 34·f(0) = 55·1 + 34·0 = 55` ✓. Every coefficient is a Fibonacci number (`21 = F_8`, `34 = F_9`, `55 = F_{10}`), a vivid demonstration that the polynomial representation `x^n mod χ` literally carries the recurrence terms in its coefficients. No `2×2` matrix appeared — only degree-`<2` polynomials — which at order `k` means degree-`<k` polynomials and `O(k²)` per step instead of `O(k³)`.

The reduction `x² ≡ x + 1` did the work each step. Notice that at every squaring we produced a degree-2 polynomial and immediately folded its leading `x²` back down using the recurrence relation read off `χ` — this "multiply then reduce" pair is the polynomial analogue of "square the matrix," and its cost is dominated by the degree-`k` multiply (`O(k²)` schoolbook), not by the reduction. The general Kitamasa loop is exactly this trace generalized to degree `k`, and the appearance of Fibonacci numbers as coefficients is no accident: `x^n mod (x² − x − 1) = F_n x + F_{n-1}`, provable by the same induction as the matrix-power identity `M^n = [[F_{n+1}, F_n],[F_n, F_{n-1}]]`, confirming the two encodings carry identical information.

### 9.2 Why Cayley-Hamilton Licenses the Reduction

The reduction `x^n mod χ_M(x)` is valid as a computation of `M^n` because `χ_M(M) = 0` (Theorem 9.1): the substitution homomorphism `ℤ_p[x] → Mat_k(ℤ_p)`, `x ↦ M`, has `χ_M(x)` in its kernel, so it factors through the quotient `ℤ_p[x]/(χ_M)`. Hence for any polynomial `q`, `q(x) ≡ x^n (mod χ_M)` implies `q(M) = M^n`. Applying both sides to `s(k-1)` and reading the top coordinate recovers `f(n)`. The minimal polynomial equaling the characteristic polynomial (Section 3) guarantees the quotient ring has dimension exactly `k`, so no information is lost and the `k` coefficients fully determine `M^n`'s action on the orbit.

---

## 10. Generating Functions and Rational Sequences

**Definition 10.1.** The ordinary generating function of `(f(n))` is `F(x) = Σ_{n≥0} f(n) x^n`.

**Theorem 10.2 (Rationality / C-finiteness).** A sequence satisfies an order-`k` constant-coefficient linear recurrence iff its generating function is rational:

```
F(x) = P(x) / (1 - c_1 x - c_2 x² - … - c_k x^k),
```

with `deg P < k`, where the numerator is fixed by the initial values.

**Proof.** Multiply the recurrence `f(n) − c_1 f(n-1) − … − c_k f(n-k) = 0` (for `n ≥ k`) by `x^n` and sum: `(1 - c_1 x - … - c_k x^k) F(x)` is a polynomial of degree `< k` (only the boundary terms from the initial values survive), giving the stated rational form. Conversely, a rational GF with denominator of degree `k` has coefficients obeying the order-`k` recurrence read from the denominator. ∎

**Numerator from initial values.** The numerator `P(x)` is determined by the first `k` terms: `P(x) = Σ_{j=0}^{k-1} (f(j) − Σ_{i=1}^{j} c_i f(j-i)) x^j`, i.e. the "boundary correction" that the recurrence has not yet kicked in for. For Fibonacci with `f(0)=0, f(1)=1`, this collapses to `P(x) = x`, giving `F(x) = x/(1 − x − x²)`. Different initial conditions change only the numerator, never the denominator — the denominator is intrinsic to the recurrence (the operator), the numerator to the initial state, exactly mirroring the `(M, s(k-1))` split of Corollary 2.3.

**Significance.** The denominator `1 - c_1 x - … - c_k x^k` is the **reciprocal** of the characteristic polynomial (`x^k χ_M(1/x)`), tying the GF, the companion matrix, and the recurrence into one object. For Fibonacci, `F(x) = x/(1 - x - x²)`; the denominator's reciprocal roots are `φ, ψ`. This is the analytic shadow of the matrix power and the reason linear recurrences and "transfer matrices" (the graph topic `11-graphs/32-paths-fixed-length`) are the same theory: `Σ_n A^n x^n = (I - xA)^{-1}` is a matrix of rational functions, each obeying a recurrence of order `≤` the matrix dimension.

### 10.1 Worked Generating Function (Fibonacci)

Start from `f(n) = f(n-1) + f(n-2)` for `n ≥ 2`, `f(0) = 0, f(1) = 1`. Multiply by `x^n` and sum over `n ≥ 2`:

```
Σ_{n≥2} f(n) x^n = x Σ_{n≥2} f(n-1) x^{n-1} + x² Σ_{n≥2} f(n-2) x^{n-2}
F(x) − f(0) − f(1)x = x(F(x) − f(0)) + x² F(x)
F(x) − x = x F(x) + x² F(x)
F(x)(1 − x − x²) = x      ⇒      F(x) = x / (1 − x − x²).
```

The denominator `1 − x − x²` is `x² χ_M(1/x)` with `χ_M(x) = x² − x − 1`, confirming Theorem 10.2's reciprocal relationship. Partial-fraction decomposition over the roots `1/φ, 1/ψ` of the denominator recovers Binet's formula — the GF route and the spectral route (Section 4) give the same closed form, as they must, since both diagonalize the same operator. The radius of convergence `1/φ` is the reciprocal of the dominant root, encoding the growth rate analytically.

### 10.2 Closure Properties as Matrix Operations

The class of C-finite (linearly recurrent) sequences is closed under addition, the Cauchy product, and the Hadamard (term-wise) product. Each closure has a matrix-operation witness: the **sum** of two C-finite sequences has transition matrix the block-diagonal `M_1 ⊕ M_2` (characteristic polynomial lcm of the two); the **Hadamard product** has transition matrix the **Kronecker product** `M_1 ⊗ M_2` (dimension `k_1 k_2`); and **shifts/sums** are the augmentations of Sections 7–8. These constructions are why augmentation always succeeds for forcing terms that are themselves C-finite: the augmented matrix is one of these closure witnesses, and powering it evaluates the combined sequence in `O((k_1 + k_2)³ log n)` or `O((k_1 k_2)³ log n)` respectively.

### 10.3 Worked Hadamard Product

Let `a(n) = 2^n` (order 1, `M_a = [2]`, `χ = x − 2`) and `b(n) = F_n` (order 2, `M_b = [[1,1],[1,0]]`, `χ = x² − x − 1`). The term-wise product `c(n) = 2^n F_n` is C-finite of order `≤ 2`, with transition matrix the Kronecker product `M_a ⊗ M_b = 2·M_b = [[2,2],[2,0]]` and characteristic polynomial `x² − 2x − 4` (the original `x² − x − 1` with each root doubled: `2φ, 2ψ`). Powering this `2×2` matrix evaluates `2^n F_n` directly at huge `n` mod `p`. The Kronecker construction is the general recipe: the product of a `k_1`-order and a `k_2`-order C-finite sequence is C-finite of order `≤ k_1 k_2`, with the dimension growth that makes high-order Hadamard products the one genuinely expensive closure. Here the product happened to collapse back to order 2 because one factor was order 1.

### 10.4 The Unifying Picture

Sections 2–10 are all facets of one statement: *the sequence is an orbit of a fixed linear operator, and every question about it is a question about powers of that operator.* The companion matrix is the operator's matrix; the characteristic polynomial is its minimal/characteristic polynomial; the eigenvalues are its spectrum; the generating function is `(I − xM)^{-1}` contracted against the initial state; Cayley-Hamilton/Kitamasa is the operator's annihilating polynomial; and augmentation is enlarging the operator to absorb a forcing term. The graph topic `11-graphs/32-paths-fixed-length` is the *same* operator viewed as a transfer/adjacency matrix, with `(A^k)[i][j]` a walk count instead of a recurrence term — one mathematics, two interpretations.

---

## 11. Fast Matrix Multiplication and Lower Bounds

The `O(k³ log n)` bound assumes schoolbook multiply. Subcubic algorithms apply because the counting/recurrence semiring is a **ring** (it has subtraction):

| Multiply algorithm | Exponent `ω` | Cost of `M^n` |
|--------------------|-------------|----------------|
| Schoolbook | 3 | `O(k³ log n)` |
| Strassen (1969) | 2.807 | `O(k^{2.807} log n)` |
| Coppersmith-Winograd & successors | 2.371552 (2024) | `O(k^ω log n)` |

**Practical note.** For the small recurrence orders typical here (`k` from 2 to a few hundred), Strassen's overhead rarely pays off below `k ≈ 128`, and for the single-term case Kitamasa's `O(k² log n)` already beats *any* matrix-multiply exponent (since `k² < k^ω` for `ω > 2`). Thus fast matrix multiply matters only when the *full* matrix `M^n` is needed (e.g. a whole window of terms) and `k` is large. The information-theoretic lower bound `Ω(k²)` (reading the output) and `2 ≤ ω < 2.372` frame the gap; whether `ω = 2` is open.

**Why Kitamasa is usually the answer instead.** For a single term, Kitamasa replaces the `k × k` matrix by a degree-`<k` polynomial, so each step is `O(k²)` (schoolbook) or `O(k log k)` (NTT) — already subcubic *and* simpler than Strassen, with no recursion-threshold tuning. Fast matrix multiply is the right tool only for the rare "need the full `M^n`, large `k`, ring arithmetic" instance.

### 11.1 Exploiting Companion Sparsity

The companion matrix has only `2k − 1` nonzero entries, so a single matrix-*vector* product costs `O(k)` rather than `O(k²)`. For *small* `n`, iterating the recurrence by `n` sparse matrix-vector products is `O(kn)` — the naive loop in disguise, and the right choice when `n` is small. The catch for large `n`: *powers* of a sparse companion matrix **densify** — `M²` already has `O(k²)` nonzeros in general — so the squaring-based `M^n` cannot retain the sparsity, and each squaring reverts to `O(k³)`. This is precisely the regime where Kitamasa wins: it keeps the *characteristic polynomial* (a sparse object if the recurrence is sparse) and reduces polynomials against it, never forming the dense matrix powers. The sparsity that the matrix loses under squaring, the polynomial representation preserves.

### 11.2 Lower Bounds and the `ω` Question

The matrix-power approach inherits the multiplication exponent `ω`, where `2 ≤ ω < 2.3716`. The lower bound `Ω(k²)` is information-theoretic: any algorithm producing the full `M^n` must write its `k²` entries, and any algorithm reading `M` must touch `Ω(k²)` of its entries. Whether `ω = 2` is a central open problem in algebraic complexity. For the *single-term* problem this is moot: Kitamasa's `O(k² log n)` already matches the `Ω(k²)`-per-step output-size barrier (a degree-`<k` polynomial has `k` coefficients, and squaring two such polynomials is `Ω(k)` output, `O(k²)` schoolbook), so no improvement in `ω` helps a single term. The fast-multiply machinery is relevant only when the *entire* `M^n` matrix is the deliverable.

### 11.3 The Practical Exponent Table

| Order `k` | Need | Recommended method | Cost |
|-----------|------|--------------------|------|
| 2–10 | any | schoolbook matrix power | `O(k³ log n)`, tiny constant |
| 10–64 | single term | schoolbook matrix power (simplicity) | `O(k³ log n)` |
| 64–500 | single term | Kitamasa (schoolbook poly) | `O(k² log n)` |
| ≥ 500 | single term, NTT-friendly `p` | Kitamasa + NTT | `O(k log k log n)` |
| ≥ 128 | full `M^n`, ring `p` | Strassen down to base ~64 | `O(k^{2.807} log n)` |
| any | full window of terms, small `k` | schoolbook matrix power | `O(k³ log n)` |

For the overwhelmingly common case — a recurrence of order 2 to a few dozen, a single term, a large index — the schoolbook companion-matrix power with a hard-unrolled small multiply (senior level) is both simplest and fastest. The asymptotic machinery of Strassen and the `ω`-bound matters only for the rare large-`k` full-matrix instance, and Kitamasa subsumes the large-`k` single-term case more simply than any fast-multiply scheme.

---

## 12. Summary

- **Bijection / correctness.** `M · s(n-1) = s(n)` (Theorem 2.1) by reading the companion matrix row by row, so `s(n) = M^{n-(k-1)} s(k-1)` (Theorem 2.2) — powering the companion matrix advances the recurrence, and the top entry is `f(n)`. The recurrence and the `(M, s)` pair are in bijection (Corollary 2.3).
- **Companion ↔ characteristic polynomial.** `χ_M(x) = x^k - c_1 x^{k-1} - … - c_k` (Theorem 3.1): the companion matrix's characteristic polynomial *is* the recurrence's auxiliary equation; its roots are the characteristic roots.
- **Spectrum / closed form.** `f(n) = Σ_r α_r λ_r^n` (Binet for Fibonacci); counts grow like `λ_max^n`. Eigenvalues give asymptotics, never exact integer terms (irrational roots) — those require integer matrices mod a prime.
- **Binary exponentiation.** Correct by the set-bit loop invariant and commutativity of powers of one matrix; `O(k³ log n)` time, `O(k²)` space, `≤ 2⌊log₂ n⌋+2` multiplies (Theorems 5.1–5.2).
- **Modular pipeline.** `φ_p(M^n) = φ_p(M)^n` (Corollary 6.2) justifies reducing in the inner loop; CRT across primes recovers exact large values.
- **Augmentation.** A constant forcing term embeds as a self-looping `1` state component (Theorem 7.1, characteristic polynomial gains the factor `(x-1)`); prefix sums and polynomial forcing terms fold in the same way (Section 8), reflecting closure of C-finite sequences.
- **Cayley-Hamilton / Kitamasa.** `M^n` is a degree-`<k` polynomial in `M`, so one term costs `O(k² log n)` (or `O(k log k log n)` with NTT) — a factor of `k` below the matrix power when the full matrix is not needed.
- **Generating functions.** A sequence is linearly recurrent iff its GF is rational with denominator the reciprocal characteristic polynomial — the analytic face of the same operator, linking to the transfer-matrix view of `11-graphs/32-paths-fixed-length`.
- **Eventual periodicity.** Over `ℤ_p` the residue sequence cycles with period dividing the order of `M` in `GL_k(ℤ_p)` (the Pisano period for Fibonacci) — a finite-state-space consequence of the matrix view that turns huge-index batch queries into `O(1)` table lookups.
- **Trace invariants.** `tr(M^n) = Σ_r λ_r^n` (Lucas numbers for Fibonacci) gives a cheap, independent cross-check on any computed power via Newton's identities — verification that needs no second algorithm.

The throughline across all of these: **a constant-coefficient linear recurrence is the iteration of one fixed linear operator, the companion matrix; every theorem is a property of that operator's powers, and every algorithm is a way to compute a high power of it efficiently** — by squaring (the matrix), by reducing modulo its annihilating polynomial (Kitamasa), or by reconstructing across moduli (CRT). The graph sibling `11-graphs/32-paths-fixed-length` is the identical operator wearing a combinatorial costume.

### Complexity Cheat Table

| Task | Method | Complexity |
|------|--------|-----------|
| `n`-th term, order `k`, mod `p` | companion matrix power | `O(k³ log n)` |
| `n`-th term, large `k`, single term | Kitamasa (Cayley-Hamilton) | `O(k² log n)` |
| `n`-th term, large `k`, NTT-friendly `p` | Kitamasa + NTT | `O(k log k log n)` |
| Full `M^n` (window of terms), large `k` | Strassen / `ω`-multiply | `O(k^ω log n)` |
| Inhomogeneous (`+b`, `+poly(n)`) | augment then power | `O((k+d+1)³ log n)` |
| Exact non-modular term | CRT across primes | `O(k³ log n · #primes)` |
| Prefix sum of terms | prefix-sum augmentation | `O((k+1)³ log n)` |
| Coupled system of `m` recurrences | block / Kronecker matrix | `O((Σ k_i)³ log n)` |
| Hadamard product of two C-finite | Kronecker product matrix | `O((k_1 k_2)³ log n)` |

**Reading the table.** The first three rows are the common cases: a plain term, a large-order single term, and an NTT-accelerated large-order term. The augmentation rows (inhomogeneous, prefix sum) only inflate the order by the forcing term's own order `d` (or `1` for a constant), so the cost penalty is modest. The Kronecker rows show the one genuinely expensive closure — term-wise products square the dimension — which is why Hadamard products of high-order sequences are the rare case where even the matrix view becomes costly and one looks for problem-specific structure instead.

### Closing Notes

- **The companion matrix is the recurrence** — its top row is the coefficients, its characteristic polynomial is the auxiliary equation, and its powers are the sequence's shifts. Every algorithm here flows from that identification.
- **Eigenvalues for growth, integer matrices for exactness** — the irrationality of characteristic roots is the formal reason floating-point closed forms (Binet) fail for exact terms.
- **Augmentation is closure of C-finite sequences made constructive** — anything that itself obeys a linear recurrence can be folded into the state.
- **Kitamasa is the polynomial face of Cayley-Hamilton** — use it to shave a factor of `k` for single-term queries at large order.

Foundational references: companion matrices and the characteristic polynomial in any linear-algebra text (Hoffman-Kunze); Binet's formula and linear recurrences in *Concrete Mathematics* (Graham-Knuth-Patashnik); generating functions and C-finite sequences in Stanley (*Enumerative Combinatorics*) and Flajolet-Sedgewick (*Analytic Combinatorics*); Cayley-Hamilton / Kitamasa for recurrence reduction; Strassen (1969) and successors for fast multiply. Sibling topic: `11-graphs/32-paths-fixed-length` (the transfer-matrix / walk-counting angle of the same machinery).

### Theorem Index

For quick navigation, the load-bearing results of this document are:

- **Theorem 2.1 / 2.2** — the transition `M · s(n-1) = s(n)` and the power formula `s(n) = M^{n-(k-1)} s(k-1)`; the correctness backbone.
- **Proposition 2.4** — uniqueness of the companion matrix, making the recurrence↔matrix correspondence a genuine bijection.
- **Theorem 3.1** — `χ_M(x) = x^k − c_1 x^{k-1} − … − c_k`; the companion's characteristic polynomial is the recurrence's auxiliary equation.
- **Theorem 4.1** — dominant-root growth `f(n) = Θ(λ_max^n)`; the size estimate driving CRT prime budgeting.
- **Theorems 5.1 / 5.2** — binary-exponentiation correctness (set-bit invariant) and `O(k³ log n)` complexity.
- **Propositions 6.1 / 6.3, Corollary 6.2** — modular homomorphism legitimizing inner-loop reduction; CRT reconstruction for exact values.
- **Theorem 7.1** — constant augmentation and its `(x−1)·χ_M` characteristic polynomial.
- **Theorems 8.1, 9.1, 9.2** — prefix-sum augmentation, Cayley-Hamilton, and the Kitamasa `O(k² log n)` speedup.
- **Theorem 10.2** — C-finiteness ⇔ rational generating function with reciprocal-characteristic denominator.
- **Closure witnesses (10.2–10.3)** — sum (block-diagonal), Hadamard product (Kronecker), shift/sum (augmentation) — the constructive proofs that C-finite sequences form a ring.

Each is anchored by a worked numeric example (Fibonacci recurs as the running thread), so the abstract statements can always be checked against a concrete computation that the naive loop also reproduces. The single unifying idea: **a constant-coefficient linear recurrence is the iteration of a fixed linear operator, and every algorithm here is a way to compute a high power of that operator efficiently — by squaring the matrix, reducing a polynomial modulo its characteristic polynomial, or reconstructing across primes.**
