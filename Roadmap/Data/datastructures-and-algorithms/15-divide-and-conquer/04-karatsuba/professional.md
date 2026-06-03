# Karatsuba Multiplication — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Three-Product Identity (Formal Derivation)
3. Bilinear Complexity: Why Three Is Optimal for a 2-Way Split
4. Solving the Recurrence via the Master Theorem
5. Evaluate–Multiply–Interpolate: The Universal Scheme
6. Toom-Cook Generalization and Interpolation
7. Complexity of Toom-k: n^(log_k(2k−1))
8. Carry Propagation and the Integer/Polynomial Correspondence
9. The Limit Toward FFT
10. Lower Bounds and the Multiplication Exponent
11. Summary

---

## 1. Formal Definitions

**Definition 1.1 (Big integer in base `B`).** Fix an integer radix `B ≥ 2`. A non-negative integer `x` of `m` limbs is written `x = Σ_{i=0}^{m-1} x_i B^i` with each `x_i ∈ {0, …, B−1}`. The **length** of `x` is `m`. Multiplication and addition of such representations are the objects of study.

**Definition 1.2 (Polynomial multiplication).** For polynomials `P(t) = Σ_{i=0}^{n-1} a_i t^i` and `Q(t) = Σ_{i=0}^{n-1} c_i t^i` over a commutative ring `R`, the product `R(t) = P(t)Q(t) = Σ_{l=0}^{2n-2} r_l t^l` has coefficients given by the **convolution**

```
r_l = Σ_{i+j=l} a_i c_j.
```

**Definition 1.3 (Integer/polynomial correspondence).** Evaluating a polynomial at `t = B` recovers an integer: if `P(B) = x` and `Q(B) = y` (with coefficients in `[0, B)`), then `(PQ)(B) = xy`. Thus integer multiplication is **polynomial multiplication followed by carry propagation** (Section 8). All the algebra of fast multiplication is cleanest stated for polynomials.

**Notation conventions.** Throughout, `n` is the operand length (limbs or polynomial degree+1), `B` the radix, `M(n)` the cost of multiplying two length-`n` operands, `ω` the matrix/bilinear exponent where relevant, and `T(n)` the recursion cost. We write `lg = log₂`. The "schoolbook" or "long" multiplication is the direct convolution at cost `Θ(n²)`. The **rank** of a bilinear map counts the essential (non-scalar) multiplications needed to compute it.

**Historical note.** In 1956 Kolmogorov conjectured that integer multiplication requires `Ω(n²)` operations and organized a seminar around proving it. In 1960 the 23-year-old Anatoly Karatsuba presented the `O(n^{1.585})` algorithm within a week of hearing the conjecture, refuting it; Karatsuba & Ofman published it in 1962. Toom (1963) and Cook (1966) generalized it to the Toom-`k` family; Schönhage & Strassen (1971) reached `O(n log n log log n)` via FFT; and Harvey & van der Hoeven (2019) attained the conjectured-optimal `O(n log n)` bit complexity. Karatsuba is thus both the historical and conceptual *first step* of fast multiplication — the moment the quadratic barrier fell.

**Definition 1.4 (Bilinear algorithm).** A **bilinear algorithm** for a bilinear map `β(u, v)` computes `r` products `p_k = ℓ_k(u)·m_k(v)` of linear forms `ℓ_k, m_k`, then outputs each result coordinate as a linear combination `Σ_k γ_{ik} p_k`. The number `r` of products is the algorithm's **multiplicative complexity**; its minimum is the **rank** of `β` (used in Section 3). Karatsuba is the rank-3 bilinear algorithm for `2×2` polynomial multiplication.

---

## 2. The Three-Product Identity (Formal Derivation)

Split each operand into two halves at the midpoint `n/2`, with `B' = B^{n/2}` (or, for polynomials, `t^{n/2}`):

```
x = a·B' + b,     y = c·B' + d,     where a,b,c,d have length n/2.
```

**Theorem 2.1 (Karatsuba identity).** The product satisfies

```
xy = z2·B'² + z1·B' + z0,
```

where

```
z2 = a·c,
z0 = b·d,
z1 = (a + b)(c + d) − z2 − z0   ( = a·d + b·c).
```

**Proof.** Expand directly:

```
xy = (aB' + b)(cB' + d) = ac·B'² + (ad + bc)·B' + bd.
```

So the true coefficients are `z2 = ac`, the middle `z1' = ad + bc`, and `z0 = bd`. Now compute the auxiliary product and subtract:

```
(a+b)(c+d) = ac + ad + bc + bd = z2 + (ad + bc) + z0,
```

hence `(a+b)(c+d) − z2 − z0 = ad + bc = z1'`. Therefore the defined `z1` equals the required middle coefficient, and the recombination `z2·B'² + z1·B' + z0` equals `xy`. ∎

**Remark (multiplication count).** The identity is computed with the **three** products `ac`, `bd`, `(a+b)(c+d)`. The remaining operations — the additions `a+b`, `c+d`, the two subtractions for `z1`, and the shifted adds for recombination — are all `Θ(n)` linear-cost. This is precisely the data that produces the recurrence `T(n) = 3T(n/2) + Θ(n)` of Section 4.

**Remark (alternative point set).** Evaluating the product polynomial `R(t) = (at+b)(ct+d)` at `t ∈ {0, 1, −1}` yields the equivalent identity with `(a−b)(c−d)` in place of `(a+b)(c+d)`:

```
R(0) = bd = z0,
R(1) = (a+b)(c+d) = z2 + z1' + z0,
R(−1) = (a−b)(c−d) = z2 − z1' + z0,
z1' = [R(1) − R(−1)]/2,   z2 = [R(1) + R(−1)]/2 − z0.
```

Both are "Karatsuba": three products determined by three evaluation points of a degree-2 polynomial (Section 5).

### 2.1 Worked Verification

Take `x = 1234`, `y = 5678` with split base `B = 100` (`half = 2`):

```
a = 12, b = 34;   c = 56, d = 78.
z2 = a·c = 12·56 = 672
z0 = b·d = 34·78 = 2652
(a+b)(c+d) = 46·134 = 6164
z1 = 6164 − 672 − 2652 = 2840          (check: a·d + b·c = 936 + 1904 = 2840 ✓)
xy = 672·10000 + 2840·100 + 2652 = 7 006 652 = 1234·5678 ✓
```

Exactly three multiplications (`12·56`, `34·78`, `46·134`) reproduce the product; the naive expansion would need four (`12·56`, `12·78`, `34·56`, `34·78`). The fourth is eliminated because only the *sum* `ad + bc`, not the two cross terms individually, appears in the result.

### 2.2 Correctness of the Recombination Shift

**Proposition 2.2.** The recombination `xy = z2·B'² + z1·B' + z0` is exact over `ℤ` (carry-free) regardless of the magnitudes of `z0, z1, z2`.

**Proof.** Substituting the values from Theorem 2.1 into `z2·B'² + z1·B' + z0` gives `ac·B'² + (ad+bc)·B' + bd`, which is the expansion of `(aB'+b)(cB'+d) = xy` by distributivity in the polynomial ring `ℤ[B']`. No assumption on the size of the coefficients relative to `B'` is used; the identity holds in `ℤ` as a polynomial evaluated at `B'`. Carry normalization (Section 8) is a *separate* canonicalization that does not affect the integer value. ∎

This is why the algorithm is conceptually "polynomial multiply, then carry": the coefficient identity is exact independent of the base, and the base only enters when redistributing overflow into limbs.

---

## 3. Bilinear Complexity: Why Three Is Optimal for a 2-Way Split

Multiplying two linear polynomials `(at + b)(ct + d)` is a **bilinear map** `ℝ²×ℝ² → ℝ³` sending `((a,b),(c,d))` to the three coefficients `(ac, ad+bc, bd)`. The minimum number of *essential* (bilinear) multiplications to compute a bilinear map is its **rank**.

**Theorem 3.1.** The bilinear map of `2×2` polynomial multiplication (degree-1 × degree-1) has rank exactly **3** over any infinite field.

**Proof sketch.** *Upper bound:* Karatsuba's identity (Theorem 2.1) computes it with three products `ac`, `bd`, `(a+b)(c+d)`, so rank `≤ 3`. *Lower bound:* the three output coefficients `ac`, `ad+bc`, `bd` are linearly independent quadratic forms; a rank-2 bilinear scheme would express all three outputs as linear combinations of two products `(α₁a+β₁b)(γ₁c+δ₁d)` and `(α₂a+β₂b)(γ₂c+δ₂d)`. Counting dimensions (the space of products of two such linear forms is 2-dimensional in the 3-dimensional output space) shows two products cannot span all three independent coefficients; the leading and trailing coefficients `ac`, `bd` together with the cross term over-determine any 2-product attempt. Hence rank `≥ 3`. ∎

**Consequence.** Karatsuba is **optimal among 2-way-split bilinear schemes**: you cannot beat `3T(n/2)` with a balanced halving. Improvements must change the *split* (Toom-k, Section 6) or the *evaluation domain* (FFT, Section 9), not reduce below three products for a 2-way split. This is the theoretical reason the algorithm's structure is forced.

### 3.1 The Tensor / Bilinear-Form Statement

A bilinear map `β : U × V → W` can be written via a tensor `T ∈ U* ⊗ V* ⊗ W`. Its **rank** is the minimum `r` such that `T = Σ_{k=1}^r u_k ⊗ v_k ⊗ w_k` for rank-1 tensors. Each rank-1 term corresponds to one essential multiplication: form the scalar `⟨u_k, ·⟩·⟨v_k, ·⟩` and distribute it to the outputs via `w_k`. For `2×2` polynomial multiplication the tensor has format `2 × 2 × 3`, and Karatsuba's decomposition exhibits the three rank-1 terms:

```
product 1 (a·c):           u = (1,0), v = (1,0), contributes to z2 and (via −1) to z1
product 2 (b·d):           u = (0,1), v = (0,1), contributes to z0 and (via −1) to z1
product 3 ((a+b)(c+d)):    u = (1,1), v = (1,1), contributes to z1
```

So `z1 = product3 − product1 − product2`, exactly Theorem 2.1. The rank-3 decomposition is essentially unique up to the symmetry group of the problem.

### 3.2 Why Recursion Lifts the Rank Bound to the Exponent

**Proposition 3.2.** If a `(k × k)`-split bilinear multiplication has rank `r`, then recursive application gives an integer/polynomial multiply of cost `Θ(n^{log_k r})`.

**Proof.** Each level reduces a size-`n` problem to `r` size-`n/k` sub-products plus `Θ(n)` linear combination (forming the `r` evaluation operands and recombining the outputs by the fixed rank-1 weight vectors). The recurrence `T(n) = r·T(n/k) + Θ(n)` solves (master theorem, Case 1 since `r > k`) to `Θ(n^{log_k r})`. For Karatsuba `k = 2, r = 3`, giving `Θ(n^{log₂3})`. ∎

This is the bridge from the *static* rank bound of Theorem 3.1 to the *asymptotic* exponent: lowering the rank `r` of the base bilinear map directly lowers the recursive exponent `log_k r`. Toom and FFT are exactly the search for split schemes with the best rank-to-size ratio.

---

## 4. Solving the Recurrence via the Master Theorem

**Theorem 4.1.** The Karatsuba recurrence

```
T(n) = 3·T(n/2) + Θ(n),     T(1) = Θ(1),
```

solves to `T(n) = Θ(n^{log₂3}) = Θ(n^{1.5849625…})`.

**Proof (master theorem).** Write `T(n) = aT(n/b) + f(n)` with `a = 3`, `b = 2`, `f(n) = Θ(n) = Θ(n^1)`. The critical exponent is

```
log_b a = log₂ 3 ≈ 1.58496.
```

Compare `f(n) = Θ(n^1)` with `n^{log_b a} = n^{1.585}`. Since `1 < log₂3`, there exists `ε = log₂3 − 1 > 0` with `f(n) = O(n^{log_b a − ε})`. This is **Case 1** of the master theorem, giving `T(n) = Θ(n^{log_b a}) = Θ(n^{log₂3})`. ∎

**Proof (recursion tree, explicit).** Level `i` has `3^i` nodes of size `n/2^i`, each doing `Θ(n/2^i)` non-recursive work, so level cost is `3^i · Θ(n/2^i) = Θ(n)·(3/2)^i`. Summing `i = 0 … lg n`:

```
T(n) = Θ(n) · Σ_{i=0}^{lg n} (3/2)^i = Θ(n) · Θ((3/2)^{lg n}).
```

Now `(3/2)^{lg n} = n^{lg(3/2)} = n^{lg 3 − 1}`, so `T(n) = Θ(n · n^{lg3 − 1}) = Θ(n^{lg3})`. The series is dominated by its last (leaf) level because the ratio `3/2 > 1`: the leaves do the bulk of the work, a hallmark of master-theorem Case 1. ∎

**Corollary 4.2 (the naive split).** The four-product divide-and-conquer `T(n) = 4T(n/2) + Θ(n)` has `log₂4 = 2`, so `T(n) = Θ(n²)` — identical to schoolbook. The entire asymptotic gain of Karatsuba is the reduction `4 → 3`, i.e. `log₂4 = 2 → log₂3 ≈ 1.585`.

**Remark (sensitivity of the exponent).** The exponent `log₂ a` is exquisitely sensitive to the product count `a` at a fixed split `b = 2`: `a = 4 → 2.000`, `a = 3 → 1.585`, and hypothetically `a = 2 → 1.000` (unattainable by Theorem 3.1's rank bound). Each saved product subtracts a meaningful amount from the exponent, which is why bilinear-rank reductions are so valuable and why decades of research chase even fractional improvements (e.g. the `2×2` integer case is rank-3-optimal, but `3×3` Toom uses 5 of a possible-naive 9, and larger blocks admit further savings).

### 4.1 Worked Recursion-Tree Count

Take `n = 8` with cutoff `1` to count leaf multiplications exactly. The tree has branching factor 3 and depth `log₂8 = 3`:

```
depth 0:   1 problem  of size 8
depth 1:   3 problems of size 4
depth 2:   9 problems of size 2
depth 3:  27 problems of size 1   ← leaves: 27 = 3³ base multiplies
```

Schoolbook on size 8 does `8² = 64` digit-multiplies; Karatsuba does `3³ = 27` leaf multiplies plus the linear combine work — already fewer at `n = 8` in pure multiplication count (though the combine overhead pushes the *practical* crossover higher). In general the leaf count is `3^{log₂ n} = n^{log₂3}`, matching Theorem 4.1's leaf-dominated sum.

### 4.2 The Exact Constant via the Akra-Bazzi Refinement

The master theorem gives the `Θ`-order; the **leading constant** follows from summing the recursion-tree series exactly. With `T(n) = 3T(n/2) + cn` and `T(1) = c₀`:

```
T(n) = c₀·n^{log₂3} + cn·Σ_{i=0}^{log₂n − 1} (3/2)^i
     = c₀·n^{log₂3} + cn·[((3/2)^{log₂n} − 1)/((3/2) − 1)]
     = c₀·n^{log₂3} + 2cn·(n^{log₂3 − 1} − 1)
     = (c₀ + 2c)·n^{log₂3} − 2cn.
```

So `T(n) ∼ (c₀ + 2c)·n^{log₂3}`: the constant absorbs both the leaf cost `c₀` and twice the per-level linear coefficient `c`. This explains why a *cheaper combine* (smaller `c`, e.g. fewer additions or the `(a−b)(c−d)` variant avoiding the `a+b` carry growth) directly lowers the constant even though it cannot change the exponent — the engineering payoff that crossover tuning (`senior.md`) exploits.

---

## 5. Evaluate–Multiply–Interpolate: The Universal Scheme

Karatsuba, Toom-Cook, and FFT are all instances of one three-phase scheme for polynomial multiplication.

**The scheme.** To multiply `P, Q` of degree `< n`, whose product `R = PQ` has degree `< 2n−1` and is determined by `2n−1` coefficients:

1. **Evaluate.** Pick `2n−1` distinct points `t₀, …, t_{2n−2}` and compute `P(t_l)`, `Q(t_l)`.
2. **Multiply (pointwise).** Compute `R(t_l) = P(t_l)·Q(t_l)` — these are the **essential products**, `2n−1` of them.
3. **Interpolate.** Recover the coefficients of `R` from its `2n−1` values via the unique interpolating polynomial (a linear solve / Lagrange interpolation).

**Theorem 5.1.** A degree-`d` polynomial is uniquely determined by its values at `d+1` distinct points (the Vandermonde matrix is invertible). Hence the scheme is correct: the interpolation in phase 3 recovers `R` exactly.

**Instances.**

| Scheme | Split parts `k` | Product degree | Points used | Essential products |
|--------|-----------------|----------------|-------------|--------------------|
| Karatsuba | 2 | 2 | 3 (e.g. `0,1,∞`) | 3 |
| Toom-3 | 3 | 4 | 5 (e.g. `0,1,−1,2,∞`) | 5 |
| Toom-k | `k` | `2k−2` | `2k−1` | `2k−1` |
| FFT | n | `2n−2` | `2n` roots of unity | `O(n)` pointwise, transforms `O(n log n)` |

The point `∞` denotes reading the **leading coefficient** (`R(∞) := lim_{t→∞} R(t)/t^{deg} = a_{k−1}c_{k−1}`), which costs only one product of the top sub-coefficients. The genius of FFT is choosing the points to be **roots of unity**, so evaluation and interpolation become FFTs computable in `O(n log n)` rather than `O(n²)` (Section 9).

### 5.1 Worked Lagrange Interpolation for Karatsuba

The three points `{0, 1, ∞}` recover the degree-2 product `R(t) = z2·t² + z1·t + z0` from values `R(0) = z0`, `R(1) = z2+z1+z0`, `R(∞) = z2`:

```
z0 = R(0)
z2 = R(∞)
z1 = R(1) − R(0) − R(∞)      # = (a+b)(c+d) − bd − ac
```

The `3×3` system in matrix form (rows = constraints at `∞, 1, 0`, columns = coefficients `z2, z1, z0`):

```
[1 0 0] [z2]   [R(∞)]
[1 1 1]·[z1] = [R(1) ]
[0 0 1] [z0]   [R(0) ]
```

This matrix is lower/upper-triangular up to row order, trivially invertible, and the inverse is integer (no division) — which is *why* the 2-way split needs no exact-division bookkeeping, unlike Toom-3's `{2,3,6}` denominators. Karatsuba is the unique evaluate-interpolate scheme whose interpolation is division-free.

### 5.2 Generalized Vandermonde Invertibility

**Theorem 5.2.** For distinct nodes `s_0, …, s_d` the Vandermonde matrix `V_{l,i} = s_l^i` has determinant `∏_{l<m}(s_m − s_l) ≠ 0`, hence is invertible.

**Proof.** The determinant formula is the classical Vandermonde identity, proved by row-reduction or by noting `det V` is a polynomial in the `s_l` vanishing whenever two coincide, of the right degree, with leading term matching the product. Since the nodes are distinct, every factor `(s_m − s_l)` is nonzero, so `det V ≠ 0`. ∎

This guarantees the interpolation phase is always well-defined for any fast-multiply scheme; the *cost* of applying `V^{-1}` (and whether its entries are integral) is what distinguishes Karatsuba (division-free) from Toom-`k` (small-constant divisions) from FFT (roots-of-unity Vandermonde, where `V^{-1}` is itself a scaled DFT).

---

## 6. Toom-Cook Generalization and Interpolation

**Setup.** Split each operand into `k` parts of size `n/k`:

```
P(t) = Σ_{i=0}^{k-1} a_i t^i,     Q(t) = Σ_{i=0}^{k-1} c_i t^i,
```

where each `a_i, c_i` has length `n/k` (and `t = B^{n/k}` for integers). The product `R(t) = P(t)Q(t)` has degree `2k−2`, hence `2k−1` coefficients `r_0, …, r_{2k−2}`.

**Phase 1 (evaluate).** Choose `2k−1` points `S = {s_0, …, s_{2k−2}}` (typically `{0, ±1, ±2, …, ∞}`). Compute `P(s_l)` and `Q(s_l)`; each is a sum of the `k` sub-parts weighted by powers of `s_l` — linear-cost `Θ(n)` work.

**Phase 2 (multiply).** Form the `2k−1` products `w_l = P(s_l)Q(s_l)`. These are the recursive multiplications, each on operands of size `≈ n/k`.

**Phase 3 (interpolate).** Solve the Vandermonde system `V·r = w` for the coefficient vector `r = (r_0, …, r_{2k−2})`, where `V_{l,i} = s_l^i`. Since the `s_l` are distinct, `V` is invertible; `V^{-1}` is a fixed rational matrix precomputed once. For integer Toom, the divisions in `V^{-1}` are arranged to be **exact** (the convolution coefficients are integers), using known sequences of additions, subtractions, and exact divisions by small constants (2, 3, 6, …).

**Theorem 6.1 (Toom-3 explicit).** With points `{0, 1, −1, 2, ∞}` and product coefficients `r_0…r_4`, the evaluations are

```
w_0 = R(0)  = a_0 c_0,
w_1 = R(1)  = (a_0+a_1+a_2)(c_0+c_1+c_2),
w_2 = R(−1) = (a_0−a_1+a_2)(c_0−c_1+c_2),
w_3 = R(2)  = (a_0+2a_1+4a_2)(c_0+2c_1+4c_2),
w_4 = R(∞)  = a_2 c_2,
```

and interpolation recovers `r_0 = w_0`, `r_4 = w_4`, with `r_1, r_2, r_3` obtained by a fixed sequence of `±` and exact divisions by 2 and 3. This uses **5** products (vs 9 for naive `3×3`).

**Proof.** Each `w_l = R(s_l)` by definition of `R = PQ` and `P(s_l), Q(s_l)`. The `5×5` Vandermonde matrix on `{0,1,−1,2,∞}` is invertible (distinct nodes, with `∞` handled as the leading coefficient), so the linear solve uniquely yields `r_0…r_4`. The specific add/subtract/divide schedule is the row-reduction of `V^{-1}` arranged for exact integer division. ∎

### 6.1 Worked Toom-3 Interpolation Schedule

A standard exact-division interpolation sequence (Bodrato's schedule) recovers `r₀…r₄` from `w₀, w₁, w₂, w₃, w₄ = R(0), R(1), R(−1), R(2), R(∞)`:

```
r0 = w0
r4 = w4
t1 = (w1 + w2) / 2          # even part:  r0 + r2 + r4
t2 = (w1 − w2) / 2          # odd part:   r1 + r3
r2 = t1 − r0 − r4
r3 = (w3 − r0 − r2·4 − r4·16 − t2·... ) / 6   # solve for the remaining odd coeff
r1 = t2 − r3
```

The exact details of the `r3` line depend on the chosen point set, but the structure is invariant: **all divisions are by the small constants `{2, 3, 6}` and are provably exact** because the `w_l` are integer evaluations of an integer-coefficient polynomial, so the numerators are divisible by construction. A non-exact division signals a transcription error in the schedule — the debug-build assertion `remainder == 0` (recommended in `senior.md`) catches exactly this class of bug.

### 6.2 Why `{0, 1, −1, 2, ∞}` and Not Arbitrary Points

The point set is chosen so that (1) `0` and `∞` give "free" products (`a₀c₀` and `a₂c₂`, no additions), (2) `1` and `−1` make the even/odd split fall out (their sum and difference isolate even- and odd-degree coefficients), and (3) the remaining point `2` uses only powers-of-two weights (`1, 2, 4`), which are shifts, keeping the evaluation cheap. The resulting Vandermonde inverse has entries with denominators only in `{2, 3, 6}`, all exactly invertible over `ℤ` after clearing. Larger or "random" points work mathematically but inflate the evaluation/interpolation constant — exactly the trade-off that caps practical `k`.

---

## 7. Complexity of Toom-k: n^(log_k(2k−1))

**Theorem 7.1.** Toom-`k` satisfies the recurrence

```
T(n) = (2k−1)·T(n/k) + Θ(n)     (the Θ(n) absorbs evaluation + interpolation, with a constant growing in k),
```

solving to `T(n) = Θ(n^{log_k(2k−1)})`.

**Proof.** Master theorem with `a = 2k−1`, `b = k`, `f(n) = Θ(n)`. The critical exponent is `log_k(2k−1)`. For every `k ≥ 2`, `2k−1 > k`, so `log_k(2k−1) > 1`, and `f(n) = Θ(n^1)` is polynomially smaller than `n^{log_k(2k−1)}` — Case 1 — giving `T(n) = Θ(n^{log_k(2k−1)})`. ∎

**Exponent table.**

| `k` | products `2k−1` | exponent `log_k(2k−1)` |
|-----|-----------------|------------------------|
| 2 (Karatsuba) | 3 | `log₂3 ≈ 1.58496` |
| 3 (Toom-3) | 5 | `log₃5 ≈ 1.46497` |
| 4 (Toom-4) | 7 | `log₄7 ≈ 1.40368` |
| 5 | 9 | `log₅9 ≈ 1.36521` |
| 10 | 19 | `log₁₀19 ≈ 1.27875` |
| `k → ∞` | `2k−1` | `→ 1⁺` |

**Theorem 7.2 (the limit).** `lim_{k→∞} log_k(2k−1) = 1`.

**Proof.** `log_k(2k−1) = ln(2k−1)/ln k`. As `k → ∞`, `ln(2k−1) = ln k + ln(2 − 1/k) → ln k + ln 2`, so the ratio `→ (ln k + ln 2)/ln k = 1 + ln2/ln k → 1`. ∎

**Corollary 7.3 (rate of approach).** The convergence is slow: `log_k(2k−1) − 1 ≈ ln2/ln k`, so reaching exponent `1.1` needs `ln k ≈ ln2/0.1 ≈ 6.93`, i.e. `k ≈ 1000`. A Toom-1000 split is absurd in practice — its interpolation matrix is `1999×1999` with enormous constants. This quantifies *why* FFT, not ever-larger Toom, is the route to near-linear: FFT achieves the `O(n log n)` behavior that Toom only *limits toward* without the exploding constant, because its evaluation points (roots of unity) make the transform itself fast.

**The catch.** The hidden constant in `Θ(n)` *grows* with `k` (the interpolation matrix has `(2k−1)²` entries with larger magnitudes and more exact divisions). So although the exponent tends to 1, increasing `k` indefinitely is counterproductive: the constant blows up before the exponent gain pays off, and beyond a moderate `k` the asymptotically superior **FFT** (Section 9) dominates anyway. This is why practical libraries stop at Toom-4 / Toom-6.5 / Toom-8.5 and then switch to FFT.

---

## 8. Carry Propagation and the Integer/Polynomial Correspondence

**Proposition 8.1.** Let `P(t) = Σ a_i t^i`, `Q(t) = Σ c_i t^i` with `0 ≤ a_i, c_i < B`, and `R = PQ = Σ r_l t^l`. Then the integer product `xy` where `x = P(B), y = Q(B)` equals `R(B)`, but the coefficients `r_l` may exceed `B−1`; the integer's canonical limbs are obtained by the **carry-normalization** map

```
for l = 0, 1, 2, …:   limb_l = r_l mod B;   r_{l+1} += ⌊r_l / B⌋.
```

**Proof.** `R(B) = Σ_l r_l B^l = (Σ_i a_i B^i)(Σ_j c_j B^j) = xy` by the substitution homomorphism `t ↦ B`. Each `r_l = Σ_{i+j=l} a_i c_j ≤ (l+1)(B−1)² ` can exceed `B`, so a single coefficient is not yet a valid limb; the carry map redistributes the excess `⌊r_l/B⌋` into the next position, yielding limbs in `[0, B)`. The process terminates because each `r_l` is finite and the carry strictly decreases as it propagates upward. ∎

**Consequence (clean separation).** Fast multiplication is correctly understood as two phases: (1) **polynomial convolution** `r_l = Σ_{i+j=l} a_i c_j` computed by Karatsuba/Toom/FFT — *carry-free, exact over `ℤ`* — followed by (2) a single linear **carry pass**. Polynomials need only phase 1; integers add phase 2. This is the formal statement behind the engineering advice "compute coefficients, then normalize carries" (`middle.md`, `senior.md`). All the asymptotic content lives in phase 1; phase 2 is `Θ(n)`.

**Remark (the `a+b` overflow).** In the integer setting, `a+b` may carry out of its `n/2`-limb window into an extra limb, so `(a+b)(c+d)` occupies up to `n + 2` limbs. This is a property of phase-1 coefficients being unnormalized, not a separate phenomenon — Proposition 8.1's "coefficients can exceed `B`" applied to the auxiliary product.

### 8.1 Worked Carry Pass

Multiply `99 × 99` with `B = 10` to see unnormalized coefficients normalize. The carry-free convolution of `[9,9]` (i.e. `9 + 9x`) with `[9,9]`:

```
r0 = 9·9            = 81
r1 = 9·9 + 9·9      = 162
r2 = 9·9            = 81
```

These coefficients `[81, 162, 81]` are all `≥ B = 10` — invalid as limbs. The carry pass (Proposition 8.1):

```
limb0 = 81 mod 10 = 1;  carry = 8;       r1 = 162 + 8 = 170
limb1 = 170 mod 10 = 0; carry = 17;      r2 = 81 + 17 = 98
limb2 = 98 mod 10 = 8;  carry = 9
limb3 = 9
→ limbs (low→high) = [1, 0, 8, 9] = 9801 = 99·99 ✓
```

The carry **cascaded across three positions** (`r0`'s carry into `r1`, whose own carry into `r2`, whose carry into a new `r3`). An implementation that propagated only one position would yield `…0 8 9` truncated wrong — the formal version of the "lost recombination carry" failure mode (`senior.md` §6.3).

### 8.2 Termination and Bound of the Carry Pass

**Proposition 8.2.** The carry pass terminates in `O(n)` steps and the final result has at most `len(x) + len(y)` limbs.

**Proof.** Each convolution coefficient `r_l ≤ (l+1)(B−1)² < n·B²`, so `⌊r_l/B⌋ < n·B`, a carry of at most `O(log_B n)` extra limbs' worth, absorbed into the next position which then has value `< n·B² + n·B < (n+1)B²`. The invariant "incoming carry `< n·B`" is preserved, and the index advances monotonically, so after at most `len(x)+len(y)` positions plus a final `O(log_B n)` carry settle, all limbs are in `[0, B)`. The product of an `m`-limb and a `k`-limb number is `< B^{m}·B^{k} = B^{m+k}`, hence at most `m+k` limbs. ∎

---

## 9. The Limit Toward FFT

Section 7 shows Toom-`k` approaches exponent 1 but with exploding constants. The resolution is to take the evaluation points to be **roots of unity**, turning evaluation and interpolation themselves into fast transforms.

**Definition 9.1 (DFT).** Over a ring containing a primitive `N`-th root of unity `ω`, the **Discrete Fourier Transform** of a length-`N` coefficient vector `(a_0, …, a_{N-1})` is `(â_0, …, â_{N-1})` with `â_l = Σ_j a_j ω^{lj}` — i.e. evaluation of the polynomial at all `N`-th roots of unity simultaneously.

**Theorem 9.2 (Convolution theorem).** Pointwise product in the DFT domain corresponds to (cyclic) convolution in the coefficient domain:

```
DFT(P · Q) = DFT(P) ⊙ DFT(Q)   (componentwise),
```

so `P·Q = DFT^{-1}( DFT(P) ⊙ DFT(Q) )`, using a transform size `N ≥ 2n−1` (zero-padded) to realize *linear* (acyclic) convolution.

**Theorem 9.3 (FFT cost).** The DFT and its inverse can be computed in `O(N log N)` ring operations by the Cooley-Tukey recursion (the **Fast Fourier Transform**), which factors the `N`-point DFT into two `N/2`-point DFTs:

```
T_FFT(N) = 2·T_FFT(N/2) + O(N) = O(N log N).
```

**Corollary 9.4 (fast multiplication).** Multiplying two degree-`< n` polynomials costs `O(n log n)` ring operations: two forward FFTs, `O(n)` pointwise products, one inverse FFT. For **integers**, working modulo a prime `p` with a root of unity (NTT) keeps everything exact, then a carry pass (Section 8) finishes the job; the Schönhage-Strassen algorithm achieves `O(n log n log log n)` bit complexity by recursive FFT over a suitable ring, and Harvey–van der Hoeven (2019) reached the conjectured-optimal `O(n log n)` bit complexity.

**The conceptual ladder.** Schoolbook evaluates the convolution directly (`Θ(n²)`); Karatsuba and Toom-`k` are evaluate–multiply–interpolate at a *fixed small* number of points (lowering the exponent toward 1 but with growing constants); FFT is the *limit* — evaluate at `Θ(n)` cleverly chosen points where the evaluation/interpolation themselves cost only `O(n log n)`. Karatsuba is the first nontrivial rung; FFT is the top.

| Method | Points | Eval+interp cost | Pointwise products | Total |
|--------|--------|------------------|--------------------|-------|
| Schoolbook | — | — | `Θ(n²)` | `Θ(n²)` |
| Karatsuba | 3 (per level) | `Θ(n)` per level | 3 per level | `Θ(n^{1.585})` |
| Toom-k | `2k−1` per level | `Θ(n)` (const ↑ in k) | `2k−1` per level | `Θ(n^{log_k(2k−1)})` |
| FFT | `Θ(n)` roots of unity | `O(n log n)` | `O(n)` | `O(n log n)` |

### 9.1 Worked NTT Multiplication

Multiply `P = 1 + 2x` and `Q = 3 + 4x` (product `3 + 10x + 8x²`, degree 2, needing transform size `N = 4`) over `ℤ_p` with `p = 17` and a primitive 4th root of unity `ω = 4` (`4² = 16 ≡ −1`, `4⁴ ≡ 1 mod 17`):

```
coefficients (zero-padded to N=4):  P = [1,2,0,0],  Q = [3,4,0,0]
evaluate at ω^0=1, ω^1=4, ω^2=16(=−1), ω^3=13(=4³=64≡13):
  P̂ = [1+2, 1+2·4, 1+2·16, 1+2·13] = [3, 9, 33≡16, 27≡10]
  Q̂ = [3+4, 3+4·4, 3+4·16, 3+4·13] = [7, 19≡2, 67≡16, 55≡4]
pointwise: R̂ = [3·7, 9·2, 16·16, 10·4] = [21≡4, 18≡1, 256≡1, 40≡6]
inverse NTT (use ω^{-1}=13, divide by N^{-1}=4^{-1}=13 mod 17):
  R = [3, 10, 8, 0]
```

So `R = 3 + 10x + 8x²` — the exact convolution, computed entirely in modular integer arithmetic (no rounding). For integers, set `x = B` and carry-normalize. When coefficients can exceed `p`, run several NTT-friendly primes and recombine by CRT (Section 8 of `senior.md`).

### 9.2 The Cooley-Tukey Split, Made Explicit

The `N`-point DFT factors into evens and odds:

```
â_l = Σ_{j even} a_j ω^{lj} + Σ_{j odd} a_j ω^{lj}
    = E_l + ω^l · O_l,
```

where `E` is the `N/2`-point DFT of the even-indexed coefficients and `O` of the odd-indexed, and `ω` is a primitive `N`-th root. Using `ω^{l + N/2} = −ω^l`, the two halves of the output are `â_l = E_l + ω^l O_l` and `â_{l+N/2} = E_l − ω^l O_l` — the **butterfly**. This recursion is `T(N) = 2T(N/2) + O(N) = O(N log N)`, structurally the *same* divide-and-conquer shape as Karatsuba but with branching factor 2 and `O(N)` combine, landing in master-theorem Case 2 (`O(N log N)`) rather than Case 1.

---

## 10. Lower Bounds and the Multiplication Exponent

**The schoolbook baseline.** Direct convolution does `Θ(n²)` coefficient multiplications, the trivial upper bound. Reading the `2n−1` outputs and `2n` inputs forces `Ω(n)`.

**Bilinear rank framing.** Multiplying degree-`< n` polynomials is a bilinear map of **rank** `R(n)`; `M(n) = Θ(R(n))` for the essential-multiplication count. Karatsuba shows `R(2) = 3` (Theorem 3.1), and recursion lifts this to `R(n) = O(n^{log₂3})`. Toom-`k` gives `R(n) = O(n^{log_k(2k−1)})`. FFT-based methods achieve `R(n) = O(n log n)` over rings with roots of unity.

**Theorem 10.1 (FFT lower bound, restricted models).** Over models where only `±` and a single bilinear product layer are allowed, `Ω(n log n)` lower bounds are known for certain related problems; for general integer multiplication, the long-standing question of whether `Θ(n log n)` is optimal was settled *upward* by Harvey–van der Hoeven (2019) who proved an `O(n log n)` **upper** bound, conjectured to be tight. No `ω(n)` superlinear lower bound is known for the bit complexity of integer multiplication in the general model — it remains open whether `o(n log n)` is achievable.

**The rank ladder, summarized.** The progression of fast multiplication is a sequence of better rank-to-size ratios for the underlying bilinear multiply:

```
schoolbook:  rank n²    on n×n          → exponent 2
Karatsuba:   rank 3     on 2×2 split    → exponent log₂3 ≈ 1.585
Toom-3:      rank 5     on 3×3 split    → exponent log₃5 ≈ 1.465
Toom-k:      rank 2k−1  on k×k split    → exponent log_k(2k−1) → 1
FFT:         O(n)       pointwise after O(n log n) transform → exponent ~1 (×log)
```

Each step lowers `log_k r` either by finding a cheaper base scheme (Karatsuba's rank-3 vs naive rank-4) or by enlarging the split (Toom), until the FFT collapses the evaluation/interpolation cost itself. Karatsuba is the first nontrivial entry — the proof that `rank < (split size)²` is possible at all.

**Practical exponent selection.** For realistic sizes the *constant* dominates the asymptotic exponent:

| `n` (limbs) | Best practical method | Reason |
|-------------|------------------------|--------|
| ≤ ~30 | schoolbook | tiny constant, cache-friendly |
| ~30–300 | Karatsuba / Toom-2.5 | exponent gain beats modest constant |
| ~300–thousands | Toom-3 / Toom-4 | lower exponent, manageable constant |
| thousands+ | FFT / Schönhage-Strassen | `n log n` finally wins |

The theory says "use a smaller exponent for larger `n`"; the practice says "the crossovers are where (constant × n^exponent) curves intersect," measured per machine (`senior.md` §4).

### 10.1 The Substitution Homomorphism and Bit vs Word Complexity

There are two cost models, and Karatsuba's exponent statement must be read in the right one.

- **Word/coefficient model.** Count ring operations on `O(1)`-sized coefficients. Here Karatsuba is `Θ(n^{log₂3})` where `n` is the number of words. This is the model used for polynomial multiplication and for fixed-precision limb arithmetic.
- **Bit model.** Count bit operations. Multiplying two `N`-bit integers with `b`-bit limbs uses `n = N/b` limbs; the word-model bound `n^{log₂3}` becomes `(N/b)^{log₂3}` *word* multiplies, each costing `O(b²)` bits if done by hardware schoolbook on the limbs, so the bit complexity is `Θ((N/b)^{log₂3} · b²)`. The recursion is typically carried all the way down, giving the clean bit bound `Θ(N^{log₂3})`.

**Proposition 10.2.** The substitution map `ev_B : ℤ[t] → ℤ`, `P ↦ P(B)`, restricted to polynomials with coefficients in `[0, B)`, is a bijection onto `ℤ_{≥0}` and a ring homomorphism on representatives modulo carry. Consequently any polynomial-multiplication algorithm transfers to integer multiplication at the same word-model exponent, plus a `Θ(n)` carry pass.

**Proof.** Injectivity: distinct coefficient vectors in `[0,B)^n` give distinct base-`B` expansions (uniqueness of positional representation). Surjectivity: every non-negative integer has a base-`B` expansion. Homomorphism on values: `ev_B(P+Q) = ev_B(P)+ev_B(Q)` and `ev_B(PQ) = ev_B(P)ev_B(Q)` because `ev_B` is a ring homomorphism `ℤ[t] → ℤ` at `t = B`; the only subtlety is that `PQ`'s coefficients may leave `[0,B)`, repaired by the carry pass (Proposition 8.1). ∎

### 10.2 Galactic vs Practical Algorithms

The asymptotically best integer multiply, Harvey–van der Hoeven's `O(n log n)`, is **galactic**: its constant is so large (the crossover is estimated above `n ≈ 2^{1729}` bits) that it never runs on real hardware. Schönhage-Strassen (`O(n log n log log n)`) is the genuinely-used FFT method in GMP. Karatsuba and Toom occupy the *practically dominant* band (a few words to a few thousand), which is where essentially all real multiplication happens — cryptographic operands are 256–8192 bits, i.e. squarely in the Karatsuba/Toom regime. The lesson: asymptotic optimality and practical relevance are different axes, and Karatsuba's enduring importance is on the practical one.

---

## 11. Summary

- **Three-product identity.** Splitting `x = aB' + b`, `y = cB' + d`, the product is `z2·B'² + z1·B' + z0` with `z2 = ac`, `z0 = bd`, and the saved `z1 = (a+b)(c+d) − z2 − z0 = ad + bc`. Proved by direct expansion; the alternative `(a−b)(c−d)` form comes from evaluating at `{0,1,−1}`.
- **Optimality.** The `2×2` polynomial-multiplication bilinear map has rank exactly 3, so Karatsuba is optimal among balanced 2-way splits — improvement requires changing the split (Toom) or the domain (FFT).
- **Recurrence.** `T(n) = 3T(n/2) + Θ(n)` is master-theorem Case 1, giving `Θ(n^{log₂3}) ≈ Θ(n^{1.585})`; the naive 4-product split gives `log₂4 = 2`, i.e. `Θ(n²)` — the whole gain is `4 → 3`.
- **Universal scheme.** Karatsuba, Toom, and FFT are all evaluate–multiply–interpolate: a degree-`d` product is fixed by `d+1` point values (invertible Vandermonde). Karatsuba uses 3 points, Toom-`k` uses `2k−1`, FFT uses `Θ(n)` roots of unity.
- **Toom-k complexity.** `T(n) = (2k−1)T(n/k) + Θ(n) = Θ(n^{log_k(2k−1)})`; the exponent decreases monotonically toward 1 as `k → ∞`, but the interpolation constant grows, capping the useful `k` before FFT takes over.
- **Integer = polynomial + carry.** Convolution coefficients `r_l = Σ_{i+j=l} a_i c_j` are computed carry-free over `ℤ` by any fast method; a single `Θ(n)` carry pass `limb_l = r_l mod B`, `carry = ⌊r_l/B⌋` produces canonical limbs. All asymptotic content is in the carry-free convolution.
- **The FFT limit.** Choosing evaluation points to be roots of unity makes evaluation/interpolation themselves `O(n log n)` (Cooley-Tukey), via the convolution theorem `P·Q = DFT^{-1}(DFT P ⊙ DFT Q)`. This is the asymptotic endpoint of the ladder that Karatsuba begins; Schönhage-Strassen and Harvey–van der Hoeven push integer multiplication to `O(n log n)` bit complexity.

### Complexity Cheat Table

| Method | Recurrence | Exponent | Notes |
|--------|-----------|----------|-------|
| Schoolbook | — | `n²` | direct convolution |
| Karatsuba (Toom-2) | `3T(n/2)+Θ(n)` | `log₂3 ≈ 1.585` | rank-3 optimal 2-split |
| Toom-3 | `5T(n/3)+Θ(n)` | `log₃5 ≈ 1.465` | 5 points |
| Toom-k | `(2k−1)T(n/k)+Θ(n)` | `log_k(2k−1) → 1` | const grows in `k` |
| FFT / NTT | `2T(n/2)+O(n)` per transform | `n log n` | roots of unity |
| Schönhage-Strassen | recursive FFT | `n log n log log n` (bit) | classic optimal-ish |
| Harvey–van der Hoeven | — | `n log n` (bit) | conjectured optimal |

### Worked End-to-End (tying the sections together)

Multiply `x = 5678`, `y = 1234` (answer `7 006 652`) and trace which theorem governs each step:

```
Section 2: split B=100 → a=56,b=78,c=12,d=34
Section 2: z2=56·12=672, z0=78·34=2652, (a+b)(c+d)=134·46=6164
Section 2: z1=6164−672−2652=2840                      (3-product identity)
Section 8: coefficients [672,2840,2652] in base 100; carry-normalize
           → 672·10000 + 2840·100 + 2652 = 7 006 652  (carry pass)
Section 4: each of the 3 sub-products recurses → T(n)=3T(n/2)+O(n)
Section 3: 3 products is rank-optimal for this 2×2 split
Section 5: {0,1,∞} interpolation recovers z0,z1,z2 division-free
```

Every numeric step is an instance of a theorem above: the identity (2), the carry pass (8), the recurrence (4), optimality (3), and interpolation (5). This is the value of the formal treatment — the one worked multiplication is simultaneously a proof witness for the whole chain.

Foundational references: Karatsuba & Ofman (1962); Toom (1963) and Cook (1966) for Toom-Cook; Cooley & Tukey (1965) for the FFT; Schönhage & Strassen (1971); Harvey & van der Hoeven (2019), "Integer multiplication in time `O(n log n)`"; Knuth TAOCP Vol. 2 §4.3.3; Brent & Zimmermann, *Modern Computer Arithmetic*; Bodrato (2007) for the Toom-3 interpolation schedule; and sibling topics in `15-divide-and-conquer` for the master theorem and divide-and-conquer framework.
