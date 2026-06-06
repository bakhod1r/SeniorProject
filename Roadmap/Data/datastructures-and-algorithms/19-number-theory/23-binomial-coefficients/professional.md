# Binomial Coefficients C(n, k) — Mathematical Foundations and Complexity

## Table of Contents

1. [Formal Definitions](#1-formal-definitions)
2. [Equivalence of the Three Definitions](#2-equivalence-of-the-three-definitions)
3. [Pascal's Identity (Two Proofs)](#3-pascals-identity-two-proofs)
4. [Symmetry and the Binomial Theorem](#4-symmetry-and-the-binomial-theorem)
5. [The Hockey-Stick Identity (Two Proofs)](#5-the-hockey-stick-identity-two-proofs)
6. [Vandermonde's Identity (Two Proofs)](#6-vandermondes-identity-two-proofs)
7. [Correctness of the Algorithms (Loop Invariants)](#7-correctness-of-the-algorithms-loop-invariants)
8. [Correctness of the Modular Method](#8-correctness-of-the-modular-method)
9. [Complexity Analysis](#9-complexity-analysis)
10. [Numerical Stability](#10-numerical-stability)
11. [The Boundary with Lucas and Prime Powers](#11-the-boundary-with-lucas-and-prime-powers)
11b. [Generalized Binomial Coefficients and Generating Functions](#11b-generalized-binomial-coefficients-and-generating-functions)
11c. [Additional Identities with Proofs](#11c-additional-identities-with-proofs)
11d. [The Maximum of a Row and Asymptotics](#11d-the-maximum-of-a-row-and-asymptotics)
11e. [Legendre's Formula and a Proof of Kummer's Theorem](#11e-legendres-formula-and-a-proof-of-kummers-theorem)
11f. [Connection to Polynomial Multiplication and NTT](#11f-connection-to-polynomial-multiplication-and-ntt)
11g. [Complexity Lower Bounds and Optimality](#11g-complexity-lower-bounds-and-optimality)
12. [Summary](#12-summary)

---

## 1. Formal Definitions

Throughout, `n, k` are integers with `n ≥ 0`, and `p` denotes a prime. We give three equivalent definitions and prove they coincide in §2.

**Definition 1.1 (Combinatorial).** `C(n, k)` is the number of `k`-element subsets of an `n`-element set `S`:

```
C(n, k) = #{ A ⊆ S : |A| = k }.
```

By convention `C(n, k) = 0` for `k < 0` or `k > n`, and `C(n, 0) = 1` (the empty subset).

**Definition 1.2 (Factorial closed form).** For `0 ≤ k ≤ n`,

```
C(n, k) = n! / (k! · (n − k)!),     where m! = ∏_{j=1}^{m} j, and 0! = 1.
```

**Definition 1.3 (Multiplicative / falling factorial).**

```
C(n, k) = (1/k!) · ∏_{i=0}^{k−1} (n − i) = n^{\underline{k}} / k!,
```

where `n^{\underline{k}} = n(n−1)···(n−k+1)` is the falling factorial. This extends to **real or negative** `n` (the *generalized* binomial coefficient), unlike Definitions 1.1–1.2 which require `n ∈ ℤ≥0`.

**Definition 1.4 (Generating function / recurrence).** `C(n, k)` is the unique array satisfying

```
C(0, 0) = 1,   C(n, k) = 0 for k < 0 or k > n,
C(n, k) = C(n−1, k−1) + C(n−1, k)    (Pascal's identity).
```

Equivalently, `C(n, k)` is the coefficient of `xᵏ` in `(1 + x)ⁿ`.

---

## 2. Equivalence of the Three Definitions

**Theorem 2.1.** Definitions 1.1, 1.2, and 1.3 give the same value for all `0 ≤ k ≤ n`.

*Proof (1.1 ⟺ 1.2).* Count the number of **ordered** `k`-tuples of distinct elements from `S` in two ways. Directly, there are `n` choices for the first element, `n−1` for the second, …, `n−k+1` for the `k`-th, giving `n^{\underline{k}} = n!/(n−k)!` ordered tuples. Alternatively, first choose the underlying `k`-subset (`C(n,k)` ways by Def 1.1) then order it (`k!` ways). Hence

```
C(n, k) · k! = n!/(n−k)!   ⟹   C(n, k) = n! / (k!(n−k)!).
```

This is Def 1.2, and the same equation rearranged is `C(n,k) = n^{\underline{k}}/k!`, which is Def 1.3. ∎

**Corollary 2.2 (Integrality).** `C(n, k)` is always an integer. *Proof.* By Def 1.1 it counts a finite set, so it is a non-negative integer. Equivalently, `k!` divides any product of `k` consecutive integers `n(n−1)···(n−k+1)` — a fact also provable by Kummer's theorem (the `p`-adic valuation argument in §11). ∎

**Theorem 2.3.** Def 1.4 (the recurrence) produces the same array. *Proof.* §3 proves Pascal's identity for Def 1.1; the boundary conditions match; and a recurrence with fixed boundary conditions has a unique solution, so the array defined by 1.4 equals the one from 1.1. The generating-function characterization follows from §4 (the binomial theorem). ∎

---

## 3. Pascal's Identity (Two Proofs)

**Theorem 3.1 (Pascal's identity).** For `1 ≤ k ≤ n−1`,

```
C(n, k) = C(n−1, k−1) + C(n−1, k).
```

*Proof A (combinatorial / double counting).* Let `S` have `n` elements; fix a distinguished element `x ∈ S`. Partition the `k`-subsets of `S` by whether they contain `x`:

- **Subsets containing `x`:** choose the remaining `k−1` elements from `S \ {x}` (size `n−1`): `C(n−1, k−1)` of them.
- **Subsets not containing `x`:** choose all `k` elements from `S \ {x}`: `C(n−1, k)` of them.

These two classes are disjoint and exhaust all `k`-subsets, so by the sum rule `C(n,k) = C(n−1,k−1) + C(n−1,k)`. ∎

*Proof B (algebraic).* Using Def 1.2,

```
C(n−1, k−1) + C(n−1, k)
  = (n−1)!/[(k−1)!(n−k)!] + (n−1)!/[k!(n−1−k)!]
  = (n−1)!/[(k−1)!(n−1−k)!] · [ 1/(n−k) + 1/k ]
  = (n−1)!/[(k−1)!(n−1−k)!] · [ (k + n − k) / (k(n−k)) ]
  = (n−1)! · n / [ k!(n−k)! ]
  = n! / [ k!(n−k)! ] = C(n, k).    ∎
```

**Remark 3.2.** Proof A also justifies the `O(n²)` DP: each cell is computed by *one addition* of two previously computed cells, and there are `Θ(n²)` cells.

---

## 4. Symmetry and the Binomial Theorem

**Theorem 4.1 (Symmetry).** `C(n, k) = C(n, n − k)`.

*Proof.* The map `A ↦ S \ A` is a bijection between `k`-subsets and `(n−k)`-subsets of `S`; it is its own inverse and changes the size from `k` to `n−k`. A bijection preserves cardinality, so the two counts are equal. Algebraically, `n!/(k!(n−k)!)` is visibly invariant under `k ↦ n−k`. ∎

**Theorem 4.2 (Binomial theorem).** For all `n ≥ 0`,

```
(x + y)ⁿ = ∑_{k=0}^{n} C(n, k) xᵏ y^{n−k}.
```

*Proof (combinatorial).* Expand the product `(x+y)(x+y)···(x+y)` (`n` factors). Each term in the expansion chooses either `x` or `y` from each factor. A term equal to `xᵏ y^{n−k}` arises from choosing `x` in exactly `k` of the `n` factors — and there are `C(n,k)` ways to pick which factors. Summing over `k` gives the claim. ∎

**Corollary 4.3 (Row sum).** Setting `x = y = 1`: `∑_{k=0}^{n} C(n, k) = 2ⁿ` — every subset of an `n`-set, counted by size.
**Corollary 4.4 (Alternating sum).** Setting `x = −1, y = 1` (for `n ≥ 1`): `∑_{k=0}^{n} (−1)ᵏ C(n, k) = 0` — the foundation of inclusion-exclusion (sibling `26-inclusion-exclusion`).

---

## 5. The Hockey-Stick Identity (Two Proofs)

**Theorem 5.1 (Hockey-stick / Christmas-stocking).** For `0 ≤ r ≤ n`,

```
∑_{i=r}^{n} C(i, r) = C(n + 1, r + 1).
```

*Proof A (telescoping via Pascal).* By Pascal's identity, `C(i+1, r+1) − C(i, r+1) = C(i, r)`. Sum over `i = r … n`:

```
∑_{i=r}^{n} C(i, r) = ∑_{i=r}^{n} [ C(i+1, r+1) − C(i, r+1) ]
                    = C(n+1, r+1) − C(r, r+1)
                    = C(n+1, r+1) − 0 = C(n+1, r+1),
```

the middle sum telescoping and `C(r, r+1) = 0`. ∎

*Proof B (combinatorial).* Count the `(r+1)`-subsets of `{1, 2, …, n+1}`: there are `C(n+1, r+1)`. Classify each by its **largest** element. If the largest is `i+1` (for `i+1` ranging over `r+1 … n+1`, i.e. `i = r … n`), the remaining `r` elements are chosen from `{1, …, i}`, giving `C(i, r)` subsets. Summing over the possible maxima gives `∑_{i=r}^{n} C(i, r)`, which therefore equals `C(n+1, r+1)`. ∎

**Worked check.** `r = 2, n = 5`: `C(2,2)+C(3,2)+C(4,2)+C(5,2) = 1+3+6+10 = 20 = C(6,3)`. ✓

---

## 6. Vandermonde's Identity (Two Proofs)

**Theorem 6.1 (Vandermonde's identity).** For `m, n ≥ 0` and `0 ≤ r`,

```
C(m + n, r) = ∑_{k=0}^{r} C(m, k) · C(n, r − k).
```

*Proof A (combinatorial).* Take a set of `m` red and `n` blue objects (`m+n` total). The number of `r`-subsets is `C(m+n, r)`. Partition these subsets by how many reds they contain: a subset with exactly `k` reds and `r−k` blues is formed in `C(m,k)·C(n,r−k)` ways. Summing over `k = 0 … r` (terms with impossible `k` vanish because the binomials are `0`) gives the identity. ∎

*Proof B (generating functions).* By the binomial theorem, `(1+x)^m (1+x)^n = (1+x)^{m+n}`. Compare the coefficient of `xʳ` on both sides. On the right it is `C(m+n, r)`. On the left, the coefficient of `xʳ` in the product is the convolution `∑_{k=0}^{r} [x^k](1+x)^m · [x^{r−k}](1+x)^n = ∑_{k=0}^{r} C(m,k) C(n,r−k)`. Equating gives the result. ∎

**Corollary 6.2 (Sum of squares).** Setting `m = n = r`: `∑_{k=0}^{n} C(n,k)² = C(2n, n)` (using symmetry `C(n,n−k)=C(n,k)`). This is the central binomial coefficient identity.

**Worked check.** `m=n=2, r=2`: `C(2,0)C(2,2)+C(2,1)C(2,1)+C(2,2)C(2,0) = 1+4+1 = 6 = C(4,2)`. ✓

---

## 7. Correctness of the Algorithms (Loop Invariants)

### 7.1 Pascal's-triangle DP

**Claim.** After filling row `i`, `tri[i][k] = C(i, k)` for all `0 ≤ k ≤ i`.

```
Invariant I(i): for all rows j ≤ i and all 0 ≤ k ≤ j, tri[j][k] = C(j, k).

Base (i=0): tri[0][0] = 1 = C(0,0).  I(0) holds.
Step: assume I(i−1). Row i sets tri[i][0]=tri[i][i]=1 = C(i,0)=C(i,i),
      and for 1 ≤ k ≤ i−1, tri[i][k] = tri[i−1][k−1] + tri[i−1][k]
                                      = C(i−1,k−1) + C(i−1,k)   [by I(i−1)]
                                      = C(i, k)                 [Pascal, Thm 3.1].
      Hence I(i) holds.
Termination: the outer loop runs i = 0 … n, a finite range.
Postcondition: I(n) ⟹ tri[n][k] = C(n, k) for all valid k.   QED
```

### 7.2 Multiplicative formula

**Claim.** The loop `for i = 1 … k: r = r · (n−k+i) / i` ends with `r = C(n, k)`.

```
Invariant J(i): after iteration i, r = C(n−k+i, i)  (an integer).

Base (i=0): r = 1 = C(n−k, 0).  J(0) holds.
Step: assume r = C(n−k+i−1, i−1) before iteration i. The update computes
      r' = r · (n−k+i) / i.
      Now  C(n−k+i, i) = C(n−k+i−1, i−1) · (n−k+i)/i   [from C(m,i)=C(m−1,i−1)·m/i],
      so r' = C(n−k+i, i), an integer (Cor 2.2). J(i) holds, and the division is exact.
Termination: i runs 1 … k.
Postcondition: J(k) ⟹ r = C(n−k+k, k) = C(n, k).   QED
```

The exactness of each division (no truncation error) is the crucial correctness point: it holds because the partial value is always an honest binomial coefficient, hence an integer.

### 7.3 Inverse-factorial sweep

**Claim.** After the loop `for i = N … 1: invFact[i−1] = invFact[i] · i mod p`, we have `invFact[j] ≡ (j!)⁻¹ (mod p)` for all `0 ≤ j ≤ N`.

```
Precondition: invFact[N] ≡ (N!)⁻¹ (mod p)   [seeded by one Fermat inverse].
Invariant K(i): when the loop is about to process index i (descending),
                invFact[i] ≡ (i!)⁻¹ (mod p).

Base: K(N) is the precondition.
Step: from invFact[i] ≡ (i!)⁻¹, set invFact[i−1] = invFact[i]·i
      ≡ (i!)⁻¹ · i = ( (i−1)! · i )⁻¹ · i = ((i−1)!)⁻¹.   So K(i−1) holds.
Termination: i descends N → 1, finite.
Postcondition: K(j) for all 0 ≤ j ≤ N.   QED
```

---

## 8. Correctness of the Modular Method

**Theorem 8.1.** Let `p` be prime and `0 ≤ k ≤ n < p`. Then

```
C(n, k) ≡ fact[n] · invFact[k] · invFact[n−k]  (mod p),
```

where `fact[i] ≡ i! (mod p)` and `invFact[i] ≡ (i!)⁻¹ (mod p)`.

*Proof.* Since `n < p`, none of `1, 2, …, n` is a multiple of `p`, so each of `n!`, `k!`, `(n−k)!` is coprime to `p` and has a well-defined inverse mod `p` (a residue is invertible mod a prime iff it is `≢ 0`). By Def 1.2, `C(n,k) · k! · (n−k)! = n!` as integers, hence as a congruence mod `p`:

```
C(n,k) · k! · (n−k)! ≡ n! (mod p).
```

Multiply both sides by `(k!)⁻¹ (n−k)!⁻¹` (which exist):

```
C(n,k) ≡ n! · (k!)⁻¹ · ((n−k)!)⁻¹ ≡ fact[n] · invFact[k] · invFact[n−k] (mod p).   ∎
```

**Remark 8.2 (Why `n < p` is required).** If `n ≥ p`, then `n!` contains the factor `p`, so `fact[n] ≡ 0 (mod p)` and is *not* invertible; the right side may evaluate to `0` even when `C(n,k) ≢ 0 (mod p)`. Concretely, `C(p, 1) = p ≡ 0`, but for `n = p, k` with `C(p,k) ≢ 0` the formula can still misfire because intermediate inverses are undefined. This is precisely the regime where **Lucas' theorem** (§11, sibling `24`) takes over.

**Theorem 8.3 (Fermat inverse correctness).** For prime `p` and `a ≢ 0 (mod p)`, `a^(p−2) ≡ a⁻¹ (mod p)`. *Proof.* By Fermat's little theorem `a^(p−1) ≡ 1`, so `a · a^(p−2) = a^(p−1) ≡ 1`, identifying `a^(p−2)` as the inverse. Full proof in sibling `05-fermat-euler`. ∎

---

## 9. Complexity Analysis

| Algorithm | Time | Space | Notes |
|-----------|------|-------|-------|
| Pascal DP, all rows `0..n` | `Θ(n²)` | `Θ(n²)` full / `Θ(n)` one-row | `∑_{i=0}^{n}(i+1) = (n+1)(n+2)/2` additions. |
| Multiplicative single value | `Θ(min(k, n−k))` | `O(1)` | One mul + one div per step. |
| Factorial precompute | `Θ(N)` | `Θ(N)` | `N` mults for `fact`, 1 inverse, `N` mults for `invFact`. |
| Query after precompute | `Θ(1)` | `O(1)` | 2 mults, 2 reductions. |
| Single value mod `p`, no table | `Θ(k + log p)` | `O(1)` | `k` mults + one `Θ(log p)` Fermat inverse. |
| Lucas | `Θ(p + log_p n)` | `Θ(p)` | precompute to `p−1`, `Θ(log_p n)` digits. |

**Derivation of the DP cost.** Filling cell `tri[i][k]` is `O(1)` (one addition). Row `i` has `i+1` cells. Total cells `∑_{i=0}^{n}(i+1) = (n+1)(n+2)/2 = Θ(n²)`. Each is touched once ⟹ `Θ(n²)` time. Full storage is `Θ(n²)`; keeping only the previous row reduces space to `Θ(n)` while time stays `Θ(n²)`.

**Why the inverse-factorial trick is asymptotically better.** Computing each `invFact[i]` independently via Fermat is `Θ(log p)` each, total `Θ(N log p)`. The recurrence does one `Θ(log p)` inverse plus `Θ(N)` multiplies = `Θ(N + log p)`. For `N = 10⁷, p ≈ 10⁹` (`log p ≈ 30`), this is a ~30× reduction in the inverse-related work.

**Lower bound intuition.** Any method that *materializes* all of row `n` must write `Θ(n)` numbers, so `Ω(n)` is unavoidable for a full row. A single `C(n,k)` needs `Ω(k)` arithmetic in the worst case for the multiplicative form, but only `Ω(1)` table lookups after an amortized precompute — which is why precompute+lookup is optimal for many queries.

---

## 10. Numerical Stability

**Exact integer arithmetic.** Definitions 1.1–1.4 are over integers; the multiplicative-form invariant (§7.2) guarantees every intermediate is an *exact* integer, so with BigInt there is **zero** error. The only "stability" concern is overflow in fixed-width types: `C(n,k)` exceeds signed 64-bit once `C(n,k) > 2⁶³−1`; e.g. `C(67, 33) ≈ 1.4·10¹⁹ > 9.22·10¹⁸`. Detect by range or use BigInt.

**Modular arithmetic.** Under mod `p` all values stay in `[0, p)`; the only hazard is the *product* of two residues overflowing the machine word before reduction (§senior 4.1). Reducing after each multiply gives an exact result with no rounding.

**Floating-point via log-gamma — error analysis.** A common approximation is

```
C(n, k) ≈ exp( lgamma(n+1) − lgamma(k+1) − lgamma(n−k+1) ).
```

IEEE-754 `double` has a 52-bit mantissa, so it represents integers exactly only up to `2⁵³ ≈ 9.007·10¹⁵`. Any `C(n,k)` beyond that **cannot** be represented exactly, and `lgamma` itself carries relative error `~10⁻¹⁵`; after `exp`, the *absolute* error scales with the magnitude of the result. For `C(50,25) ≈ 1.26·10¹⁴` the answer is already near the exact-integer ceiling; for `C(100,50) ≈ 1.01·10²⁹` the low ~14 digits are pure noise. **Conclusion:** the log-gamma route is acceptable only for explicitly approximate uses (ratios, ranking, asymptotics); it is never valid for an exact count or a modular residue.

**Catastrophic cancellation in identity evaluation.** Evaluating an alternating sum like `∑(−1)ᵏ C(n,k)` in floating point suffers catastrophic cancellation (the true sum is `0` but rounding leaves residue near machine epsilon times the largest term). Always evaluate such identities in exact integer or modular arithmetic.

---

## 11. The Boundary with Lucas and Prime Powers

**Kummer's theorem (carries).** The `p`-adic valuation `v_p(C(n,k))` equals the number of **carries** when adding `k` and `n−k` in base `p`. *Consequence:* `p ∤ C(n,k)` iff there are no carries, i.e. each base-`p` digit of `k` is `≤` the corresponding digit of `n`. This is the structural reason behind Lucas.

**Theorem 11.1 (Lucas).** For prime `p`, writing `n = ∑ nᵢ pⁱ` and `k = ∑ kᵢ pⁱ` in base `p`,

```
C(n, k) ≡ ∏_i C(n_i, k_i)  (mod p),
```

with `C(nᵢ, kᵢ) = 0` whenever `kᵢ > nᵢ`. Each factor has both arguments `< p`, so it is computed by Theorem 8.1 with a precompute up to `p−1`. *Proof sketch:* compare coefficients of `x^k` in `(1+x)ⁿ ≡ ∏_i ((1+x)^{pⁱ})^{nᵢ} ≡ ∏_i (1 + x^{pⁱ})^{nᵢ} (mod p)`, using the freshman's-dream `(1+x)^p ≡ 1 + x^p (mod p)`. Full proof in sibling **`24-lucas-theorem`**.

**Prime powers and CRT.** For a composite modulus `M = ∏ pⱼ^{eⱼ}`, compute `C(n,k) mod pⱼ^{eⱼ}` with Andrew Granville's generalization of Lucas (handling the `p`-factors of the factorials via Wilson-like products), then recombine via **CRT** (sibling `06-crt`). The valuation `v_{p}(C(n,k))` from Kummer's theorem tells you the power of `p` dividing the answer; the unit part is handled separately. Details in sibling **`33-factorial-mod-p`**.

---

## 11b. Generalized Binomial Coefficients and Generating Functions

**Definition 11b.1 (Generalized binomial coefficient).** For *any* real (or complex) `α` and integer `k ≥ 0`,

```
C(α, k) = α(α−1)···(α−k+1) / k! = α^{\underline{k}} / k!,    C(α, 0) = 1.
```

This agrees with Def 1.1–1.3 when `α = n ∈ ℤ≥0`, but is also defined for negative and fractional `α`. It is the coefficient form behind the **generalized binomial series**.

**Theorem 11b.2 (Negative-upper-index / "upper negation").**

```
C(−n, k) = (−1)ᵏ C(n + k − 1, k),    for integer n ≥ 1, k ≥ 0.
```

*Proof.* By Def 11b.1, `C(−n, k) = (−n)(−n−1)···(−n−k+1)/k!`. Factor `−1` from each of the `k` numerator terms:

```
= (−1)ᵏ · n(n+1)···(n+k−1)/k! = (−1)ᵏ · (n+k−1)^{\underline{k}}/k! = (−1)ᵏ C(n+k−1, k).   ∎
```

This identity is the algebraic engine behind **stars-and-bars** (sibling `28-stars-and-bars`): the number of ways to write `r` as an ordered sum of `n` non-negative integers is `C(n+r−1, r) = (−1)ʳ C(−n, r)`.

**Theorem 11b.3 (Generalized binomial series).** For `|x| < 1` and any real `α`,

```
(1 + x)^α = ∑_{k=0}^{∞} C(α, k) xᵏ.
```

When `α = n ∈ ℤ≥0` all terms with `k > n` vanish (a numerator factor is `0`), recovering the finite binomial theorem (Thm 4.2). For `α = −1` it gives the geometric series `1/(1+x) = ∑ (−1)ᵏ xᵏ`, matching Thm 11b.2 with `n = 1`. *Proof:* Taylor expansion of `(1+x)^α` about `0`; the `k`-th derivative at `0` is `α^{\underline{k}}`, so the coefficient is `α^{\underline{k}}/k! = C(α, k)`. Convergence for `|x| < 1` is standard. ∎

**Corollary 11b.4 (Catalan generating function).** The Catalan numbers satisfy `Cat(n) = C(2n,n)/(n+1)`, with generating function `∑ Cat(n) xⁿ = (1 − √(1−4x))/(2x)`, expanded via Thm 11b.3 at `α = 1/2`. This links binomial coefficients to sibling `25-catalan-numbers`.

---

## 11c. Additional Identities with Proofs

**Theorem 11c.1 (Absorption / committee-chair).** For `1 ≤ k ≤ n`,

```
k · C(n, k) = n · C(n−1, k−1).
```

*Proof (combinatorial).* Count pairs `(committee of size k, designated chair within it)` from `n` people. Left side: choose the committee (`C(n,k)`) then a chair among its `k` members (`k`). Right side: choose the chair first (`n` ways) then the rest of the committee (`C(n−1,k−1)`). Both count the same set of pairs. ∎ Algebraically, `k·n!/(k!(n−k)!) = n·(n−1)!/((k−1)!(n−k)!)`. ∎

**Theorem 11c.2 (Sum of `k·C(n,k)`).** `∑_{k=0}^{n} k · C(n, k) = n · 2^{n−1}`.

*Proof.* By absorption, `k·C(n,k) = n·C(n−1,k−1)`. Sum over `k`:

```
∑_{k=0}^{n} k C(n,k) = n ∑_{k=1}^{n} C(n−1, k−1) = n ∑_{j=0}^{n−1} C(n−1, j) = n · 2^{n−1},
```

using the row-sum corollary 4.3. ∎ Probabilistically, this says the expected number of heads in `n` fair coin flips is `n/2` (divide by `2ⁿ`).

**Theorem 11c.3 (Sum of squares = central coefficient).** `∑_{k=0}^{n} C(n, k)² = C(2n, n)`.

*Proof.* This is Vandermonde (Thm 6.1) with `m = n, r = n`, combined with symmetry `C(n, n−k) = C(n, k)`:

```
C(2n, n) = ∑_{k=0}^{n} C(n, k) C(n, n−k) = ∑_{k=0}^{n} C(n, k)².   ∎
```

**Theorem 11c.4 (Subset-of-subset).** For `0 ≤ k ≤ m ≤ n`,

```
C(n, m) C(m, k) = C(n, k) C(n−k, m−k).
```

*Proof (combinatorial).* Count `(A, B)` with `B ⊆ A ⊆ [n]`, `|A| = m`, `|B| = k`. Left: pick `A` (`C(n,m)`) then `B ⊆ A` (`C(m,k)`). Right: pick `B` first (`C(n,k)`) then `A \ B` from the remaining `n−k` elements to total size `m` (`C(n−k, m−k)`). ∎

---

## 11d. The Maximum of a Row and Asymptotics

**Theorem 11d.1 (Unimodality).** For fixed `n`, the sequence `C(n, 0), C(n, 1), …, C(n, n)` is **strictly increasing** up to the middle and then strictly decreasing; the maximum is the central coefficient `C(n, ⌊n/2⌋)`.

*Proof.* Consider the ratio of consecutive terms:

```
C(n, k+1) / C(n, k) = (n − k) / (k + 1).
```

This ratio is `> 1` iff `n − k > k + 1`, i.e. `k < (n−1)/2`, and `< 1` iff `k > (n−1)/2`. So the terms rise while `k < (n−1)/2` and fall after, peaking at the middle index `⌊n/2⌋` (with a tie at `⌈n/2⌉` when `n` is odd). ∎

**Theorem 11d.2 (Central coefficient asymptotics).** By Stirling's formula `m! ∼ √(2πm)(m/e)^m`,

```
C(2n, n) ∼ 4ⁿ / √(πn).
```

*Proof sketch.* `C(2n,n) = (2n)!/(n!)²`. Substitute Stirling for each factorial; the `(·/e)` powers and `√(2π·)` factors combine to `4ⁿ/√(πn)`. ∎ This bound is why central binomial coefficients grow like `4ⁿ` (a `2ⁿ`-from-each-half effect) divided by a slowly growing `√n`, and it underlies the `O(4ⁿ/√n)` size of Catalan numbers (sibling `25`).

---

## 11e. Legendre's Formula and a Proof of Kummer's Theorem

**Definition 11e.1 (`p`-adic valuation).** `v_p(m)` is the exponent of the highest power of the prime `p` dividing `m`; `v_p(0) = +∞` by convention. It is additive: `v_p(ab) = v_p(a) + v_p(b)`.

**Theorem 11e.2 (Legendre's formula).** For a prime `p` and integer `n ≥ 0`,

```
v_p(n!) = ∑_{i≥1} ⌊n / pⁱ⌋ = (n − s_p(n)) / (p − 1),
```

where `s_p(n)` is the sum of the base-`p` digits of `n`.

*Proof.* Among `1, …, n`, exactly `⌊n/p⌋` are divisible by `p`, `⌊n/p²⌋` by `p²`, etc. Each multiple of `pⁱ` contributes one extra factor of `p` beyond those counted at lower levels, so summing `⌊n/pⁱ⌋` over `i` counts every factor of `p` in `n!` exactly once. For the closed form, write `n = ∑ aᵢ pⁱ`; then `⌊n/pʲ⌋ = ∑_{i≥j} aᵢ p^{i−j}`, and summing a geometric-style rearrangement gives `(n − s_p(n))/(p−1)`. ∎

**Theorem 11e.3 (Kummer's theorem).** `v_p(C(n, k))` equals the number of **carries** when adding `k` and `n − k` in base `p`.

*Proof.* Let `j = n − k`. By Legendre,

```
v_p(C(n,k)) = v_p(n!) − v_p(k!) − v_p(j!)
            = [ (n − s_p(n)) + (− (k − s_p(k))) + (− (j − s_p(j)) ) ] / (p − 1)
            = [ s_p(k) + s_p(j) − s_p(n) ] / (p − 1),
```

since `n = k + j`. Now, when adding `k + j` in base `p`, each carry out of a digit position reduces the digit sum by exactly `p` and increases the next position's contribution by `1`, a net loss of `p − 1` from the total digit sum. Hence `s_p(k) + s_p(j) − s_p(k+j) = (p−1)·(number of carries)`. Dividing by `p−1` gives the carry count. ∎

**Corollary 11e.4 (Lucas non-vanishing).** `p ∤ C(n,k)` iff there are **no** carries when adding `k` and `n−k` in base `p`, equivalently iff every base-`p` digit of `k` is `≤` the corresponding digit of `n`. This is exactly the condition under which all factors `C(nᵢ, kᵢ)` in Lucas' theorem (Thm 11.1) are nonzero. ∎

**Corollary 11e.5 (Integrality, revisited).** Since `v_p(C(n,k)) =` (carry count) `≥ 0` for every prime `p`, no prime appears to a negative power in `C(n,k)`; therefore `C(n,k)` is an integer. This is the number-theoretic counterpart of the combinatorial proof in Cor 2.2. ∎

---

## 11f. Connection to Polynomial Multiplication and NTT

The Vandermonde proof (Thm 6.1, Proof B) exhibits a binomial convolution as the coefficient sequence of a polynomial product. This generalizes:

**Observation 11f.1.** The full row `(C(n,0), …, C(n,n))` is the coefficient vector of `(1 + x)ⁿ`. Multiplying two such rows convolves them:

```
(1+x)^m · (1+x)^n = (1+x)^{m+n},
```

so the convolution of row `m` with row `n` is row `m+n`. Computing such a convolution naively is `Θ(mn)`; under a suitable prime modulus it can be done in `Θ((m+n) log(m+n))` via the **Number-Theoretic Transform** (sibling `15-ntt`). This is the bridge from binomial identities to fast polynomial arithmetic (sibling `22-polynomial-operations`): many generating-function manipulations that *look* like binomial sums are really polynomial multiplications in disguise, and NTT accelerates them.

**Observation 11f.2 (Why a "nice" prime helps).** NTT requires a modulus `p` of the form `c·2^m + 1` with a primitive `2^m`-th root of unity (e.g. `998244353 = 119·2²³ + 1`). The *same* factorial/inverse-factorial precompute that powers `O(1)` binomial queries also supplies the inverses NTT needs, so a combinatorics-heavy solution often shares one modular toolkit across both `C(n,k)` queries and polynomial products.

---

## 11g. Complexity Lower Bounds and Optimality

**Theorem 11g.1 (Output-size lower bound).** Any algorithm that outputs the *exact* integer `C(n, k)` must take `Ω(B)` time where `B = Θ(k log(n/k))` is the bit-length of the result (for `k ≤ n/2`), simply because writing `B` bits requires `Ω(B)` work.

*Proof.* By Stirling, `log₂ C(n,k) = Θ(k log(n/k))` for `1 ≤ k ≤ n/2`. The output has that many bits; emitting them is `Ω` of that. ∎ Consequently, exact computation cannot be `o(k log(n/k))`; the multiplicative BigInt method, doing `k` multiplies of growing numbers, is within a polylog factor of optimal.

**Theorem 11g.2 (Amortized optimality of precompute).** For `q` queries with `max n = N` under a prime modulus, the precompute-plus-lookup scheme runs in `Θ(N + q)`. Any scheme answering each query in `o(1)` is impossible (each query reads its own `n, k`), and any scheme avoiding the table must spend `Ω(k + log p)` per query; thus for `q = Ω(N)` queries the `Θ(N + q)` total is optimal up to constants. ∎

This formalizes the senior guideline: *build the table once when `q ≳ N`, otherwise compute single values.*

---

## 11h. Correctness of the One-Row (In-Place) DP

The space-optimized Pascal DP overwrites a single array `row[0..n]`, updating right-to-left. Its correctness is non-obvious because it mutates the array it reads from; we prove it formally.

**Setup.** Start with `row[j] = C(i−1, j)` for `0 ≤ j ≤ i−1` (and `row[i]` newly set to `1`). Process `k = i−1, i−2, …, 1` with `row[k] ← row[k] + row[k−1]`.

**Theorem 11h.1.** After processing all `k` for stage `i`, `row[j] = C(i, j)` for `0 ≤ j ≤ i`.

```
Invariant H(k): just before the update at index k (descending from i−1),
   row[j] = C(i, j)   for all j > k          (already updated this stage),
   row[j] = C(i−1, j) for all j ≤ k          (not yet updated this stage).

Base H(i−1): no index > i−1 has been updated except row[i] = 1 = C(i, i);
   all j ≤ i−1 still hold C(i−1, j).  ✓
Step: the update reads row[k] = C(i−1, k) and row[k−1] = C(i−1, k−1)
   (both still old, since k−1 < k has not been touched), and writes
   row[k] ← C(i−1, k) + C(i−1, k−1) = C(i, k)   [Pascal].
   Now row[k] = C(i, k) and indices < k are untouched, establishing H(k−1).
Termination: k descends i−1 → 1.
Postcondition: H(0) plus row[0] = 1 = C(i, 0) ⟹ row[j] = C(i, j) for all j.  QED
```

**Why right-to-left is mandatory.** If the loop ran left-to-right, the update at `k−1` would overwrite `row[k−1]` with `C(i, k−1)` *before* the update at `k` reads it, so `row[k]` would erroneously use `C(i, k−1)` instead of `C(i−1, k−1)`. The descending order guarantees every read sees the previous row's value. This is the in-place analogue of the classic 0/1-knapsack iteration-order argument.

---

## 11i. Index of Worked Numeric Examples

For verification and teaching, every major result above is anchored by a concrete check:

| Result | Example | Value |
|--------|---------|-------|
| Pascal's identity (Thm 3.1) | `C(5,2)=C(4,1)+C(4,2)` | `10 = 4 + 6` |
| Symmetry (Thm 4.1) | `C(5,2)=C(5,3)` | `10 = 10` |
| Row sum (Cor 4.3) | `∑_k C(5,k)` | `32 = 2⁵` |
| Hockey-stick (Thm 5.1) | `∑_{i=2}^5 C(i,2)` | `20 = C(6,3)` |
| Vandermonde (Thm 6.1) | `∑_k C(2,k)C(2,2−k)` | `6 = C(4,2)` |
| Modular method (Thm 8.1) | `C(6,3) mod 7` | `6` (and `20 mod 7 = 6`) |
| `n ≥ p` failure (Rem 8.2) | `C(7,1) mod 7` | `0` (= `7 mod 7`) |
| Absorption (Thm 11c.1) | `2·C(5,2)=5·C(4,1)` | `20 = 20` |
| Sum `k·C(n,k)` (Thm 11c.2) | `∑_k k·C(4,k)` | `32 = 4·2³` |
| Sum of squares (Thm 11c.3) | `∑_k C(3,k)²` | `20 = C(6,3)` |
| Subset-of-subset (Thm 11c.4) | `C(4,2)C(2,1)` | `12 = C(4,1)C(3,1)` |
| Unimodality (Thm 11d.1) | row 6 peak | `C(6,3)=20` |
| Central asymptotic (Thm 11d.2) | `C(20,10)` | `184756 ≈ 4¹⁰/√(10π)=187078` |
| Upper negation (Thm 11b.2) | `C(−3,2)` | `6 = (+1)·C(4,2)` |
| Legendre (Thm 11e.2) | `v₂(6!) = ⌊6/2⌋+⌊6/4⌋` | `4 = 3 + 1` |
| Kummer (Thm 11e.3) | `v₂(C(6,3))`: `3+3` base 2 carries | `1` (= `v₂(20)`) |

The Stirling estimate `187078` vs the exact `184756` for `C(20,10)` illustrates the ~1.3% relative error of the leading-order asymptotic at `n=10` — it tightens as `n → ∞`.

---

## 12. Summary

The binomial coefficient admits three equivalent definitions — combinatorial (count of `k`-subsets), factorial (`n!/(k!(n−k)!)`), and multiplicative (`n^{\underline{k}}/k!`) — proven identical by counting ordered tuples two ways (Thm 2.1), and always an integer (Cor 2.2). The four workhorse identities are proved both combinatorially and algebraically: **Pascal** (`C(n,k)=C(n−1,k−1)+C(n−1,k)`, the DP engine), **symmetry**, **hockey-stick** (`∑C(i,r)=C(n+1,r+1)`, by telescoping or by largest-element classification), and **Vandermonde** (`C(m+n,r)=∑C(m,k)C(n,r−k)`, by red/blue counting or by `(1+x)^m(1+x)^n`). Loop-invariant arguments establish correctness of the Pascal DP, the multiplicative loop (with *exact* integer division at every step), and the inverse-factorial sweep. The modular formula `C(n,k) ≡ fact[n]·invFact[k]·invFact[n−k] (mod p)` is correct **exactly when `p` is prime and `n < p`**, because only then are all factorials invertible. Complexity is `Θ(n²)` for the full triangle, `Θ(N)` precompute + `Θ(1)` per query for the factorial method, and the inverse-factorial recurrence cuts `Θ(N log p)` to `Θ(N + log p)`. Floating-point log-gamma loses all exactness past `2⁵³` and is banned for exact/modular work. The regime boundary is set by Kummer's theorem and crossed by **Lucas** (`24`, `n ≥ p`) and **factorial-mod-prime-power + CRT** (`33`, `06`, composite modulus).
