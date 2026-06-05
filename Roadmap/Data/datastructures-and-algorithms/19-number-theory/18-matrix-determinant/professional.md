# Matrix Determinant — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Equivalence of the Leibniz and Cofactor Definitions
3. Multilinearity and the Axiomatic Characterization
4. Effect of Elementary Row Operations
5. Why Gaussian Elimination Computes the Determinant
6. The Bareiss Algorithm and Sylvester's Identity (Fraction-Free Correctness)
7. The Multiplicative Law det(AB) = det(A)det(B)
8. Singular ⇔ det = 0
9. Determinants over Fields, Rings, and Z/pZ
10. The Matrix-Tree Theorem (Kirchhoff)
11. Complexity and Bounds
12. Summary

---

## 1. Formal Definitions

Let `A ∈ R^{n×n}` be a square matrix over a commutative ring `R` (think `R = ℝ`, `R = ℤ`, or `R = ℤ_p`). Write `S_n` for the symmetric group of permutations of `{1, …, n}`, and `sgn(σ) ∈ {+1, −1}` for the sign (parity) of `σ`.

**Definition 1.1 (Leibniz formula).** The determinant of `A` is

```
det(A) = Σ_{σ ∈ S_n}  sgn(σ) · ∏_{i=1}^{n} A[i][σ(i)].
```

There are `n!` terms, each a signed product of `n` entries, one from each row and each column.

**Definition 1.2 (Minor and cofactor).** The `(i, j)` **minor** `M_{ij}` is the determinant of the `(n−1)×(n−1)` matrix obtained by deleting row `i` and column `j`. The `(i, j)` **cofactor** is `C_{ij} = (−1)^{i+j} M_{ij}`.

**Definition 1.3 (Laplace / cofactor expansion).** For any fixed row `i`,

```
det(A) = Σ_{j=1}^{n} A[i][j] · C_{ij} = Σ_{j=1}^{n} (−1)^{i+j} A[i][j] M_{ij},
```

with the symmetric statement for any fixed column.

**Definition 1.4 (Singular).** `A` is **singular** if it has no multiplicative inverse over the fraction field of `R`; equivalently (Section 8) `det(A) = 0`.

**Notation.** `n = |rows|`; `I_n` the identity; `e_i` the `i`-th standard basis row; `Aᵀ` the transpose; `B` a bound on `|A[i][j]|`; `χ_A(x) = det(xI − A)` the characteristic polynomial; `ω` the matrix-multiplication exponent. Elementary matrices: `E_swap(i,j)`, `E_add(i,j,c)` (add `c·`row `j` to row `i`), `E_scale(i,c)`.

---

## 2. Equivalence of the Leibniz and Cofactor Definitions

**Theorem 2.1.** Definitions 1.1 (Leibniz) and 1.3 (cofactor expansion) define the same function.

**Proof.** Fix row `i` and group the `n!` Leibniz terms by the value `j = σ(i)`. For each fixed `j`, the terms with `σ(i) = j` are

```
Σ_{σ: σ(i)=j} sgn(σ) ∏_{r=1}^n A[r][σ(r)] = A[i][j] · Σ_{σ: σ(i)=j} sgn(σ) ∏_{r≠i} A[r][σ(r)].
```

The inner sum ranges over bijections `σ` from `{1,…,n}∖{i}` to `{1,…,n}∖{j}`. Reindex these as permutations `τ` of an `(n−1)`-element set; the sign of `σ` relative to `τ` differs by exactly `(−1)^{i+j}` (moving row `i` past `i−1` rows and column `j` past `j−1` columns to bring the deleted entry to the corner). The remaining signed sum over `τ` is, by Definition 1.1 applied to the smaller matrix, precisely `M_{ij}`. Hence the group contributes `A[i][j]·(−1)^{i+j}M_{ij} = A[i][j]C_{ij}`, and summing over `j` gives `Σ_j A[i][j] C_{ij} = det(A)`. ∎

**Corollary 2.2.** Both definitions are `O(n!)` as written; neither is the algorithm. The cofactor recursion `T(n) = n·T(n−1)` solves to `T(n) = Θ(n!)`. The practical computation is Section 5.

**Remark.** The sign factor `(−1)^{i+j}` in the cofactor is exactly the parity bookkeeping that, in the elimination view (Section 4), becomes "flip the sign on each row swap". The same parity of `S_n` governs both pictures.

### 2.1 Worked Equivalence on a 3×3

Take

```
A = [ 2 1 1 ]
    [ 4 3 3 ]
    [ 8 7 9 ]
```

The Leibniz sum has `3! = 6` terms, one per permutation `σ ∈ S_3`:

```
σ = (1,2,3): +A[1][1]A[2][2]A[3][3] = +2·3·9 = +54
σ = (1,3,2): −A[1][1]A[2][3]A[3][2] = −2·3·7 = −42
σ = (2,1,3): −A[1][2]A[2][1]A[3][3] = −1·4·9 = −36
σ = (2,3,1): +A[1][2]A[2][3]A[3][1] = +1·3·8 = +24
σ = (3,1,2): +A[1][3]A[2][1]A[3][2] = +1·4·7 = +28
σ = (3,2,1): −A[1][3]A[2][2]A[3][1] = −1·3·8 = −24
```

Sum: `54 − 42 − 36 + 24 + 28 − 24 = 4`. Cofactor expansion along row 1 groups these six terms by `j = σ(1)`: the `j = 1` group is `+2(3·9 − 3·7) = 2·6 = 12` (the two terms `+54, −42`), the `j = 2` group is `−1(4·9 − 3·8) = −12` (terms `−36, +24`), and the `j = 3` group is `+1(4·7 − 3·8) = 4` (terms `+28, −24`). Summing the three grouped cofactors gives `12 − 12 + 4 = 4`, identical to the Leibniz total — a concrete instance of Theorem 2.1. Each cofactor's internal `±` is precisely the regrouped sign of the parent permutations.

---

## 3. Multilinearity and the Axiomatic Characterization

The determinant is the unique function satisfying three axioms; this characterization is the cleanest way to prove its properties.

**Theorem 3.1 (Axiomatic characterization).** `det : R^{n×n} → R` is the unique function that is

1. **Multilinear in the rows:** linear in each row when the others are fixed, i.e. `det(…, αu + βv, …) = α·det(…, u, …) + β·det(…, v, …)`.
2. **Alternating:** `det(A) = 0` whenever two rows are equal.
3. **Normalized:** `det(I_n) = 1`.

**Proof sketch.** Multilinearity lets one expand `det` over the standard-basis decomposition of each row, producing a sum over functions `f : rows → columns`. The alternating property forces all terms where `f` is non-injective to vanish, leaving only permutations `σ`; alternating-ness also forces the coefficient of the `σ`-term to be `sgn(σ)` (swapping two rows negates the value, and `det(I) = 1` fixes the constant). The result is exactly the Leibniz formula, which is therefore the unique such function. ∎

**Consequences (each used elsewhere).**

- **Equal rows ⇒ `det = 0`** (axiom 2), giving the "duplicate row" singular case.
- **Swapping two rows negates `det`:** `det(…, u, …, v, …) = −det(…, v, …, u, …)`, because expanding `det(…, u+v, …, u+v, …) = 0` (alternating) and using multilinearity yields the antisymmetry.
- **Adding a multiple of one row to another preserves `det`:** `det(…, u + c·v, …, v, …) = det(…, u, …, v, …) + c·det(…, v, …, v, …) = det(…, u, …, v, …) + 0`. This is *the* reason elimination works (Section 4).
- **Scaling a row by `c` scales `det` by `c`** (multilinearity).
- **`det(Aᵀ) = det(A)`:** the Leibniz sum is symmetric under `σ ↦ σ^{-1}` and `sgn(σ) = sgn(σ^{-1})`, so row and column statements coincide.

**Non-additivity.** Multilinearity is *per row*, not across whole matrices: `det(A + B) ≠ det(A) + det(B)` in general, because `A + B` adds *every* row simultaneously, not one. This is the most common false "property".

**Worked non-additivity.** Let `A = I_2` and `B = I_2`. Then `det(A) = det(B) = 1`, but `A + B = 2I_2` has `det(2I_2) = 2·2 = 4 ≠ 1 + 1 = 2`. The discrepancy is exactly the cross terms multilinearity *would* allow if you expanded `det` along *one* row at a time — but `A+B` perturbs both rows at once, so the single-row linearity does not telescope into whole-matrix additivity. The correct whole-matrix law is the *multiplicative* one (Section 7), not an additive one.

**Worked multilinearity (single row).** With `det([[a,b],[c,d]]) = ad − bc`, scaling row 0 by `α`: `det([[αa,αb],[c,d]]) = αad − αbc = α(ad − bc)`. Splitting row 0 as `(a,b) = (a_1,b_1) + (a_2,b_2)`: `det = (a_1+a_2)d − (b_1+b_2)c = (a_1 d − b_1 c) + (a_2 d − b_2 c)`, the sum of the two determinants — multilinearity in row 0, with row 1 held fixed.

---

## 4. Effect of Elementary Row Operations

Encode each row operation as left-multiplication by an **elementary matrix**:

| Operation | Elementary matrix `E` | `det(E)` |
|-----------|-----------------------|----------|
| Swap rows `i, j` | `E_swap(i,j)` | `−1` |
| Add `c·`row `j` to row `i` | `E_add(i,j,c)` | `1` |
| Scale row `i` by `c` | `E_scale(i,c)` | `c` |

**Lemma 4.1.** Applying a row operation to `A` multiplies `det(A)` by `det(E)`. That is, `det(EA) = det(E)·det(A)`.

**Proof.** Each row operation's effect on `det` was established in Section 3 (swap negates, add preserves, scale by `c` multiplies by `c`), and `det(E)` is exactly that factor (apply the operation to `I_n` and read off its determinant via the Leibniz formula). Thus `det(EA) = det(E)·det(A)`. ∎

This is the special case of the multiplicative law (Section 7) for elementary `E`, and it is all elimination needs.

**Worked elementary determinants (`n = 3`).** Apply each operation to `I_3` and read off the determinant:

```
E_swap(0,1) = [0 1 0]   det = −1   (one transposition, sgn = −1)
              [1 0 0]
              [0 0 1]

E_add(1,0,c) = [1 0 0]  det = 1    (lower-triangular, diagonal all 1)
               [c 1 0]
               [0 0 1]

E_scale(2,c) = [1 0 0]  det = c    (diagonal product 1·1·c)
               [0 1 0]
               [0 0 c]
```

So a swap contributes `−1`, a row-add contributes `1` (hence "no det change"), and a scale by `c` contributes `c` — exactly the three rules elimination relies on, now derived as determinants of the elementary matrices themselves. Composing them, `det(E_m ⋯ E_1) = ∏ det(E_t)`, which is why the running sign in elimination is just the product of the `−1`s from swaps.

---

## 5. Why Gaussian Elimination Computes the Determinant

**Theorem 5.1.** Gaussian elimination with `s` row swaps reduces `A` to an upper-triangular matrix `U` using only swaps and "add multiple of a row" operations, and

```
det(A) = (−1)^s · ∏_{i=1}^{n} U[i][i].
```

**Proof.** Elimination writes `E_m ⋯ E_2 E_1 A = U`, where each `E_t` is either a swap (`det = −1`) or a row-add (`det = 1`). By Lemma 4.1 applied repeatedly,

```
det(U) = det(E_m) ⋯ det(E_1) · det(A) = (−1)^s · det(A),
```

since exactly `s` of the `E_t` are swaps (each contributing `−1`) and the rest are row-adds (contributing `1`). For the upper-triangular `U`, the Leibniz formula has exactly one nonzero term — the identity permutation, since any other `σ` must pick an entry below the diagonal in some row, which is `0` — so `det(U) = ∏_i U[i][i]`. Rearranging, `det(A) = (−1)^s ∏_i U[i][i]`. ∎

**Corollary 5.2 (LU view).** If no swaps are needed, `A = LU` with `L` unit lower-triangular (`det L = 1`) and `det(A) = ∏ U[i][i]`. With swaps, `PA = LU` and `det(A) = (−1)^s ∏ U[i][i]`, where `(−1)^s = det(P)`.

**Corollary 5.3 (early termination).** If at column `c` no nonzero pivot exists at or below `(c, c)`, then column `c` of the reduced matrix is zero below row `c`; the eventual `U` has a zero on its diagonal, so `det(U) = 0`, hence `det(A) = 0`. This is the singular-detection branch.

**Why the row-add operation is the workhorse.** It is the *only* operation that changes the matrix toward triangular form **without** changing the determinant (Section 3). Swaps are unavoidable (zero pivots, stability) but cost only a tracked sign; scaling is optional and is avoided in integer/Bareiss variants precisely because it would multiply the determinant by a fraction.

### 5.1 Worked Elimination with a Swap

Consider a matrix whose `(0,0)` entry is zero, forcing a swap:

```
A = [ 0 2 1 ]
    [ 1 1 1 ]
    [ 3 1 2 ]
```

**Column 0.** Pivot `(0,0) = 0`; swap row 0 with row 1 (first nonzero below), `sign = −1`:

```
[ 1 1 1 ]
[ 0 2 1 ]
[ 3 1 2 ]
```

Eliminate row 2: `row 2 ← row 2 − 3·row 0 = [0, −2, −1]` (a row-add, no det change):

```
[ 1 1 1 ]
[ 0 2 1 ]
[ 0 −2 −1 ]
```

**Column 1.** Pivot `(1,1) = 2`; eliminate row 2: `row 2 ← row 2 − (−1)·row 1 = [0, 0, 0]`:

```
[ 1 1 1 ]
[ 0 2 1 ]
[ 0 0 0 ]
```

**Read off.** The diagonal is `(1, 2, 0)`, product `0`, and `det(A) = sign · 0 = 0`. The matrix is singular — the third row collapsed to zero, revealing the row dependence `row2_orig = 3·row1_orig − ... `. The single swap flipped the sign to `−1`, but since the pivot product is `0` the sign is immaterial here. Had the bottom pivot been nonzero, the final answer would have carried the `−1`.

---

## 6. The Bareiss Algorithm and Sylvester's Identity (Fraction-Free Correctness)

Plain elimination over a field divides by pivots, introducing fractions. The Bareiss algorithm performs **fraction-free** elimination whose every intermediate is an integer equal to a minor's determinant.

**Definition 6.1 (Bareiss update).** Let `a^{(0)} = A`, `a^{(−1)}_{00} := 1` (the initial "previous pivot"). After choosing pivot `(k,k)` (assumed nonzero), define for `r, c > k`:

```
a^{(k)}[r][c] = ( a^{(k-1)}[k][k] · a^{(k-1)}[r][c] − a^{(k-1)}[r][k] · a^{(k-1)}[k][c] ) / a^{(k-2)}[k-1][k-1],
```

where `a^{(k-2)}[k-1][k-1]` is the previous pivot (taken as `1` for `k = 0`).

**Theorem 6.2 (Sylvester's identity / integer-preservation).** Each `a^{(k)}[r][c]` equals the determinant of the `(k+2)×(k+2)` submatrix of `A` formed by rows `{0,…,k, r}` and columns `{0,…,k, c}`. In particular `a^{(k)}[r][c] ∈ R` (the division is exact), and the final entry `a^{(n-2)}[n-1][n-1] = det(A)`.

**Proof idea.** The numerator `a^{(k-1)}[k][k]·a^{(k-1)}[r][c] − a^{(k-1)}[r][k]·a^{(k-1)}[k][c]` is a `2×2` determinant of leading-minor determinants. **Sylvester's determinant identity** states that for the matrix of `(k+1)`-minors built this way, this `2×2` combination equals the `(k+2)`-minor times the `k`-minor (the common leading principal minor `a^{(k-2)}[k-1][k-1]`). Dividing by that `k`-minor yields exactly the `(k+2)`-minor, which is an element of `R`. Induction on `k` establishes that every `a^{(k)}[r][c]` is the claimed minor determinant; the base cases `k = 0` (entries are `2×2` minors over the trivial previous pivot `1`) and `k = -1` (the entries themselves) anchor it. ∎

**Corollary 6.3 (exact division).** Because the quotient is provably a minor determinant in `R`, the division `/ prevPivot` is exact in `R`. Over `R = ℤ` this means integer division with zero remainder; no fractions ever arise.

**Corollary 6.4 (bounded magnitude).** Since every intermediate is a `(k+2)`-minor determinant, Hadamard's inequality (Section 11) bounds it: `|a^{(k)}[r][c]| ≤ (B√(k+2))^{k+2}`. The intermediate numbers are therefore as small as the theory permits — the central advantage over fraction-cleared elimination. With pivoting (swaps), the same identity holds after the corresponding row/column permutation, with a tracked sign.

### 6.1 Worked Bareiss Trace

Run Bareiss on the same `A` (`prev = 1` initially, pivot `(0,0) = 2`). For `r, c ∈ {1,2}`:

```
a^{(0)}[1][1] = (m[1][1]·m[0][0] − m[1][0]·m[0][1]) / 1 = (3·2 − 4·1) = 2
a^{(0)}[1][2] = (m[1][2]·m[0][0] − m[1][0]·m[0][2]) / 1 = (3·2 − 4·1) = 2
a^{(0)}[2][1] = (m[2][1]·m[0][0] − m[2][0]·m[0][1]) / 1 = (7·2 − 8·1) = 6
a^{(0)}[2][2] = (m[2][2]·m[0][0] − m[2][0]·m[0][2]) / 1 = (9·2 − 8·1) = 10
```

These four numbers are exactly the `2×2` leading minors: e.g. `a^{(0)}[1][1] = det([[2,1],[4,3]]) = 2`, `a^{(0)}[2][2] = det([[2,1],[8,9]]) = 10` — confirming Theorem 6.2. Now `prev = 2` (the old pivot), new pivot `(1,1) = 2`:

```
a^{(1)}[2][2] = (a^{(0)}[2][2]·a^{(0)}[1][1] − a^{(0)}[2][1]·a^{(0)}[1][2]) / prev
             = (10·2 − 6·2) / 2 = (20 − 12)/2 = 8/2 = 4.
```

The division by `prev = 2` is **exact** (`8/2 = 4`, no remainder), as Sylvester's identity guarantees, and the final entry `a^{(1)}[2][2] = 4 = det(A)` with `sign = +1` (no swaps). Every value stayed an integer; no fraction ever appeared.

---

## 7. The Multiplicative Law det(AB) = det(A)det(B)

**Theorem 7.1.** For `A, B ∈ R^{n×n}`, `det(AB) = det(A)·det(B)`.

**Proof.** Fix `B` and consider `f(A) = det(AB)` as a function of the rows of `A`. Row `i` of `AB` is `(row_i of A)·B`, a linear function of row `i` of `A`. Hence `f` is **multilinear** in the rows of `A`, and **alternating** (if two rows of `A` are equal, the corresponding rows of `AB` are equal, so `det(AB) = 0`). By the uniqueness in Theorem 3.1, `f(A) = c·det(A)` for a constant `c = f(I_n) = det(I_n·B) = det(B)`. Therefore `det(AB) = det(B)·det(A) = det(A)·det(B)`. ∎

**Corollary 7.2.** `det(A^{-1}) = det(A)^{-1}` when `A` is invertible (from `det(A)det(A^{-1}) = det(I) = 1`); `det(A^k) = det(A)^k`; `det(PAP^{-1}) = det(A)` (similarity-invariance), so the determinant is well-defined on linear operators independent of basis.

**Worked multiplicativity.** Let

```
A = [ 1 2 ]   B = [ 0 1 ]   AB = [ 2 3 ]
    [ 3 4 ]       [ 1 1 ]        [ 4 7 ]
```

Then `det(A) = 1·4 − 2·3 = −2`, `det(B) = 0·1 − 1·1 = −1`, and `det(AB) = 2·7 − 3·4 = 14 − 12 = 2`. Check: `det(A)·det(B) = (−2)(−1) = 2 = det(AB)`. ✓ This is the cleanest end-to-end test of a determinant implementation: pick random `A, B`, multiply them, and assert `det(AB) == det(A)·det(B)` exactly — a bug in either the multiply or the determinant breaks it (Section 8 of `senior.md`).

**Corollary 7.3 (consistency of elimination).** Section 5's correctness is a special case: `det(A) = det(E_1^{-1}⋯E_m^{-1} U) = (∏ det(E_t)^{-1})·det(U)`, and the elementary determinants are `±1` or scalars. The multiplicative law is the structural reason the whole elimination pipeline returns `det(A)`.

### 7.1 The Cauchy-Binet Generalization

Theorem 7.1 is the square case of a more general identity that we will need for the matrix-tree theorem (Section 10).

**Theorem 7.4 (Cauchy-Binet).** For `A ∈ R^{m×p}` and `B ∈ R^{p×m}` with `m ≤ p`,

```
det(AB) = Σ_{S ⊆ {1,…,p}, |S| = m}  det(A[:,S]) · det(B[S,:]),
```

where `A[:,S]` is the `m×m` submatrix of `A` on columns `S`, and `B[S,:]` the `m×m` submatrix of `B` on rows `S`.

**Proof sketch.** Expand `det(AB)` by multilinearity over the `p` choices of inner index in each of the `m` rows of `AB`; terms with a repeated inner index vanish (alternating), leaving sums over injections, which regroup into the `m`-subsets `S` with the two minor determinants as coefficients. ∎

When `m = p` there is a single subset `S = {1,…,m}` and Cauchy-Binet collapses to `det(AB) = det(A)det(B)` (Theorem 7.1). The non-square case is precisely what counts spanning trees: `det(B_i B_iᵀ) = Σ_S det(B_i[:,S])^2`, a sum of squared maximal minors.

### 7.2 The Adjugate and Cramer's Rule

The cofactors of Section 1 assemble into the **adjugate** `adj(A)`, the transpose of the cofactor matrix (`adj(A)[i][j] = C_{ji}`).

**Theorem 7.5 (Adjugate identity).** `A · adj(A) = adj(A) · A = det(A) · I_n`.

**Proof.** The `(i,i)` entry of `A·adj(A)` is `Σ_j A[i][j] C_{ij} = det(A)` (cofactor expansion along row `i`). The off-diagonal `(i,k)` entry (`i ≠ k`) is `Σ_j A[i][j] C_{kj}`, which is the cofactor expansion of a matrix with row `i` copied into row `k` — a matrix with two equal rows, so its determinant is `0`. Hence `A·adj(A) = det(A)·I`. ∎

**Corollary 7.6 (Cramer's rule).** If `det(A) ≠ 0`, then `A^{-1} = adj(A)/det(A)`, and the system `Ax = b` has the unique solution `x_i = det(A_i)/det(A)`, where `A_i` is `A` with column `i` replaced by `b`. This follows by expanding `det(A_i)` along column `i`: `det(A_i) = Σ_j b_j C_{ji} = (adj(A)·b)_i`, and `x = A^{-1}b = adj(A)b/det(A)`. Cramer's rule needs `n+1` determinants, so it is `O(n^4)` — elegant but slower than the `O(n^3)` direct solve; it matters for symbolic/closed-form work, not numerics.

---

## 8. Singular ⇔ det = 0

**Theorem 8.1.** Over a field `F`, the following are equivalent for `A ∈ F^{n×n}`:

1. `det(A) = 0`;
2. `A` is singular (no inverse);
3. the rows of `A` are linearly dependent;
4. the columns of `A` are linearly dependent;
5. `A` has nontrivial kernel (`∃ x ≠ 0` with `Ax = 0`);
6. `rank(A) < n`.

**Proof.** (2⇒1): if `A^{-1}` exists, `det(A)det(A^{-1}) = det(I) = 1`, so `det(A) ≠ 0`; contrapositive gives 1⇒¬2 hence 1⇒2 after contraposition. (1⇒3): if the rows were independent they would span `F^n`, making `A` invertible (Gaussian elimination reaches `I`), contradicting `det = 0` via Section 5 (a nonzero-pivot reduction gives nonzero `det`). (3⇔4) by `det(Aᵀ) = det(A)` and applying (1⇔3) to `Aᵀ`. (3⇔5⇔6) are standard linear-algebra equivalences (dependent rows ⇔ rank deficiency ⇔ nontrivial null space). ∎

**Remark (rings vs fields).** Over a general commutative ring `R`, `A` is invertible (in `R^{n×n}`) **iff `det(A)` is a unit of `R`**, not merely nonzero. Over `ℤ`, `A` is invertible *over `ℤ`* iff `det(A) = ±1` (unimodular); it is invertible over `ℚ` iff `det(A) ≠ 0`. This distinction matters for integer linear algebra and lattices.

**Connection to rank (sibling `19-matrix-rank`).** `det(A) = 0` is the special "rank-deficient by at least one" statement for square `A`. Rank generalizes it: the largest order of a nonzero minor equals `rank(A)`. So the determinant is the top-order instance of the minors that define rank.

### 8.1 Worked Singular Example with Dependent Rows

Take

```
A = [ 1 2 3 ]
    [ 2 4 6 ]
    [ 1 0 1 ]
```

Row 1 is exactly `2·`row 0, so the rows are linearly dependent and `A` must be singular. Elimination confirms it: `row 1 ← row 1 − 2·row 0 = [0,0,0]`, producing a zero row, hence a zero pivot in column 1 with nothing to swap in below it — `det = 0`. The Leibniz sum also vanishes by Theorem 8.1 (3⇒1). The largest nonzero minor here has order `2` (e.g. `det([[1,2],[1,0]]) = −2 ≠ 0`), so `rank(A) = 2 < 3`, the exact statement `det = 0` makes precise. The kernel vector `x = (1, 1, −1)ᵀ` satisfies `Ax = 0` (Theorem 8.1, item 5), the concrete witness of singularity.

---

## 9. Determinants over Fields, Rings, and Z/pZ

**Over `ℝ` (a field).** Division is always possible; standard elimination applies; floating point introduces rounding (handled in `senior.md`).

**Over `ℤ_p` (a finite field, `p` prime).** Every nonzero element is invertible, so elimination works with **modular-inverse pivots**: divide by `pivot` means multiply by `pivot^{-1} mod p` (existence by Fermat / extended Euclid, sibling `06-extended-euclidean-modular-inverse`). The reduction map `φ_p : ℤ → ℤ_p` is a ring homomorphism, so

```
φ_p(det(A)) = det(φ_p(A)).
```

**Proposition 9.1.** Computing the determinant of `A mod p` entrywise and reducing every operation mod `p` yields `det(A) mod p` exactly.

**Proof.** `det` is a polynomial (Leibniz) in the entries with integer coefficients; ring homomorphisms commute with integer-coefficient polynomial evaluation, so `φ_p(det(A)) = det(φ_p(A))`. Interleaving the reduction at every `+`/`×` is valid because `φ_p` is a homomorphism. ∎

**Corollary 9.2 (CRT).** Running the determinant mod coprime primes `p₁,…,p_m` and combining via CRT yields `det(A) mod ∏ pᵢ`; if `∏ pᵢ > 2|det(A)|` (sized by Hadamard) the balanced representative is the exact integer `det(A)`. This is the exact-integer pipeline.

**Over `ℤ` exactly.** Use Bareiss (Section 6) to stay fraction-free, or CRT (Corollary 9.2). A bad prime `p | det(A)` makes `φ_p(A)` singular mod `p` (`det ≡ 0`); this does not corrupt CRT reconstruction (it contributes a true `0` residue) but means a *single* `0 mod p` is inconclusive for integer singularity.

### 9.1 Worked Bad-Prime Hazard

Let `A = [[3, 0], [0, 4]]`, so `det(A) = 12` over `ℤ`. Modulo `p = 2`: `det(A) ≡ 12 ≡ 0 (mod 2)`, since `2 | 12`. A naive reader of the mod-2 result would conclude "singular", but `A` is invertible over `ℚ` (and over `ℤ` it is *not* unimodular, since `det = 12 ≠ ±1`, but it is non-singular). Modulo `p = 5`: `det(A) ≡ 12 ≡ 2 (mod 5)`, correctly nonzero. CRT over `{2, 5}` recovers `det ≡ 2 (mod 5)` and `≡ 0 (mod 2)`, giving `12 (mod 10)` — the balanced representative `12` is wrong only because `10 < 2·12`; with `{5, 7}` (`∏ = 35 > 2·12`) CRT yields the exact `12`. The lesson: pick primes whose product exceeds `2·Hadamard`, and never trust a *single* `0 mod p` as an integer-singularity verdict.

---

## 9b. The Characteristic Polynomial and Eigenvalue Product

The determinant is intimately tied to the eigenvalues of `A`.

**Definition 9b.1.** The **characteristic polynomial** is `χ_A(x) = det(xI − A)`, a monic degree-`n` polynomial whose roots are the eigenvalues `λ_1, …, λ_n` of `A` (over the algebraic closure).

**Theorem 9b.2 (det = product of eigenvalues).** `det(A) = ∏_{r=1}^{n} λ_r`, and `det(A) = (−1)^n · χ_A(0)`.

**Proof.** Setting `x = 0` in `χ_A(x) = det(xI − A)` gives `χ_A(0) = det(−A) = (−1)^n det(A)`. Since `χ_A(x) = ∏_r (x − λ_r)`, the constant term is `χ_A(0) = ∏_r(−λ_r) = (−1)^n ∏_r λ_r`. Equating, `(−1)^n det(A) = (−1)^n ∏_r λ_r`, so `det(A) = ∏_r λ_r`. ∎

**Corollary 9b.3.** `A` is singular ⇔ `det(A) = 0` ⇔ `0` is an eigenvalue of `A` ⇔ `χ_A(0) = 0`. This connects the determinant (Section 8) to the spectrum: a zero eigenvalue is exactly a nontrivial kernel vector.

**Corollary 9b.4 (trace and determinant).** The characteristic polynomial's coefficients are the elementary symmetric polynomials of the eigenvalues: the `x^{n-1}` coefficient is `−tr(A) = −Σλ_r`, and the constant term encodes `det(A) = ∏λ_r`. So the determinant and trace are the two extreme coefficients of `χ_A`. Computing `χ_A` exactly (Faddeev-LeVerrier, or interpolation over `Z/pZ` of `det(xI − A)` at `n+1` points) is an `O(n^4)` or `O(n^3 log n)` task that yields the determinant as a byproduct (its constant term, up to sign).

**Caveat.** Eigenvalues of integer matrices are generally irrational algebraic numbers, so `det = ∏λ_r` is a *theoretical* identity, not a numerical recipe for an exact integer determinant — computing `∏λ_r` in floating point reintroduces rounding. Use it for reasoning (e.g., `det(A^k) = ∏λ_r^k`, growth rates) and use integer/modular elimination for exact values.

### 9b.1 Worked Spectral Example

Take `A = [[2, 1], [1, 2]]`. Its characteristic polynomial is

```
χ_A(x) = det(xI − A) = det([[x−2, −1], [−1, x−2]]) = (x−2)² − 1 = x² − 4x + 3,
```

with roots `λ_1 = 3, λ_2 = 1`. Then `det(A) = λ_1·λ_2 = 3·1 = 3`, matching direct computation `2·2 − 1·1 = 3`. The `x^{n-1} = x^1` coefficient is `−4 = −(λ_1 + λ_2) = −tr(A)`, and the constant term `3 = χ_A(0) = (−1)^2 det(A) = det(A)` — both extreme coefficients recovered. Here the eigenvalues happened to be integers, but for a matrix like `[[0,1],[1,1]]` (the Fibonacci matrix) the eigenvalues are `(1±√5)/2`, irrational, while `det = −1` stays a clean integer — vividly showing why `∏λ_r` is the wrong route to an *exact* determinant even though the identity holds.

---

## 10. The Matrix-Tree Theorem (Kirchhoff)

**Definition 10.1 (Laplacian).** For an undirected graph `G` on `n` vertices, let `D = diag(deg(v))` and `A` its adjacency matrix. The **Laplacian** is `L = D − A`. (For weighted graphs, `A[i][j]` is the edge weight and `D` the weighted degrees.)

**Theorem 10.2 (Kirchhoff's matrix-tree theorem).** The number of spanning trees `τ(G)` of `G` equals any cofactor of `L`: delete any row `i` and column `i` from `L` and take the determinant of the resulting `(n−1)×(n−1)` matrix `L_{ii}`:

```
τ(G) = det(L_{ii})   (independent of the chosen i).
```

Equivalently `τ(G) = (1/n) ∏_{k=2}^{n} μ_k`, the product of the nonzero Laplacian eigenvalues divided by `n`.

**Proof idea (Cauchy-Binet).** Orient the edges arbitrarily to form the incidence matrix `B` (`n × m`); then `L = B Bᵀ`. Deleting row `i` gives a reduced incidence matrix `B_i` (`(n−1) × m`), and `L_{ii} = B_i B_iᵀ`. By the **Cauchy-Binet formula**,

```
det(B_i B_iᵀ) = Σ_{S, |S|=n−1} det(B_i[:,S])^2,
```

summing over `(n−1)`-edge subsets `S`. A classical fact: `det(B_i[:,S]) ∈ {−1, 0, +1}`, equal to `±1` iff the edge subset `S` forms a spanning tree, else `0`. Hence each squared term is `1` for a spanning tree and `0` otherwise, so the sum counts spanning trees. ∎

**Significance.** This reduces a combinatorial count — number of spanning trees — to a single `O(n^3)` determinant, computed exactly via Bareiss or mod-`p`+CRT (the count is a nonnegative integer; floats are wrong). It is the canonical example of the determinant as a *counting* tool and a workhorse of algebraic graph theory and network reliability.

**Corollary 10.3 (Cayley's formula).** For the complete graph `K_n`, the theorem gives `τ(K_n) = n^{n-2}` (the deleted-Laplacian determinant evaluates to `n^{n-2}`), recovering Cayley's classical count of labeled trees.

### 10.1 Worked Matrix-Tree Example

Take the triangle `K_3` on vertices `{0,1,2}` with edges `01, 12, 20`. Each vertex has degree `2`, so

```
L = D − A = [ 2 −1 −1 ]
            [ −1 2 −1 ]
            [ −1 −1 2 ]
```

Delete row 2 and column 2 (any choice works) to get the cofactor minor

```
L_{22} = [ 2 −1 ]
         [ −1 2 ]
```

with `det(L_{22}) = 2·2 − (−1)(−1) = 4 − 1 = 3`. So `τ(K_3) = 3`: the triangle has exactly three spanning trees (drop any one of its three edges). This matches Cayley `n^{n-2} = 3^{1} = 3`. Deleting a *different* row/column (say row 0, column 0) yields `det([[2,−1],[−1,2]]) = 3` as well — the theorem's claim that the cofactor is independent of the chosen index. The Laplacian is always singular (rows sum to zero, so `det(L) = 0`); the theorem extracts the tree count from a *minor*, not the full determinant.

### 10.2 Directed Graphs and the Weighted Form

For a **weighted** graph, set `A[i][j]` to the edge weight (and `D` to weighted degrees); then the same minor determinant computes `Σ_T ∏_{e ∈ T} w(e)`, the sum over spanning trees of the product of edge weights. Unit weights recover the plain count. For **directed** graphs, the analogue is the **matrix-tree theorem for arborescences**: using the out-degree (or in-degree) Laplacian, the cofactor counts spanning arborescences rooted at the deleted vertex (Tutte's theorem). All variants reduce spanning-structure counting to one `O(n^3)` determinant computed exactly (mod `p` + CRT, since the count is an exact integer).

---

## 11. Complexity and Bounds

**Theorem 11.1 (Elimination complexity).** Gaussian elimination computes `det(A)` in `Θ(n^3)` field operations and `O(n^2)` space.

**Proof.** The triple-nested loop does `Σ_{c=0}^{n-1} (n−c)^2 = Θ(n^3/3)` field operations; the final pivot product is `O(n)`. Space is the `n^2` working matrix. ∎

**Theorem 11.2 (Cofactor complexity).** Laplace expansion costs `Θ(n!)` operations: `T(n) = n·T(n−1) + O(n)`, `T(n) = Θ(n!)`. Exponentially worse; usable only as a test oracle for tiny `n`.

**Theorem 11.3 (Hadamard's inequality).** For `A ∈ ℝ^{n×n}`,

```
|det(A)| ≤ ∏_{i=1}^{n} ‖row_i(A)‖_2 ≤ (B√n)^n = n^{n/2} B^n,
```

with equality iff the rows are mutually orthogonal. Hence `det(A)` has at most `(n/2)log₂ n + n log₂ B + O(1)` bits.

**Proof sketch.** The determinant is the signed volume of the parallelepiped spanned by the rows; this volume is at most the product of the side lengths (the `‖row_i‖_2`), maximized when the sides are orthogonal (a rectangular box). The bound `‖row_i‖_2 ≤ B√n` follows since each of the `n` entries is `≤ B`. ∎

**Consequences for implementation (cf. `senior.md`).** Theorem 11.3 sizes the exact-integer computation: it decides whether `int64` suffices, how many CRT primes are needed (`Σ log pᵢ > bit bound + 1`), and bounds Bareiss intermediates (each a minor, hence `≤ (B√n)^n`).

### 11.1 Worked Hadamard and Prime-Count Estimate

Suppose `n = 50` and entries bounded by `B = 10^9`. Hadamard gives

```
|det(A)| ≤ (B√n)^n = (10^9 · √50)^50 ≈ (7.07 × 10^9)^50.
```

Taking `log_2`: each factor is `log_2(7.07×10^9) ≈ 32.7` bits, times `n = 50`, so `|det|` has at most `≈ 1636` bits. For CRT with primes near `2^31` (`≈ 31` usable bits each, leaving headroom for `int64` products), the number of primes is

```
m = ceil((1636 + 1) / 31) ≈ 53 primes,
```

plus one for safety: about `54`. Each is an independent `O(50^3) ≈ 1.25×10^5`-operation job, trivially parallel. This is why the Hadamard bound is computed *first*: it converts "compute an exact integer determinant" into a concrete, sized, parallelizable plan. Underestimating `m` corrupts the CRT reconstruction silently (the balanced representative wraps), so always round up and add a guard prime.

### 11.2 Faddeev-LeVerrier and Determinant-from-Characteristic-Polynomial

An alternative route computes `det(A)` as the constant term of `χ_A` via the **Faddeev-LeVerrier** recurrence, which produces all coefficients of `χ_A` using traces of matrix powers in `O(n^4)` field operations (`n` matrix multiplies). It is rarely competitive with `O(n^3)` elimination for the determinant alone, but it is the method of choice when you need the *entire* characteristic polynomial (e.g., all eigenvalues' symmetric functions) and want the determinant as a free byproduct. Over `Z/pZ` it is exact; over the reals it is numerically delicate (the trace-power accumulation amplifies error), so for a pure determinant, elimination remains the default.

**Theorem 11.4 (Subcubic determinant).** Over a field, `det(A)` is computable in `O(n^ω)` time, where `ω < 2.3716` is the matrix-multiplication exponent, via block LU / Bunch-Hopcroft-style recursion (a determinant computation is asymptotically equivalent to matrix multiplication). In practice schoolbook `O(n^3)` elimination wins for the `n` arising in number-theory/graph work.

**Lower bound.** Reading the `n^2` entries forces `Ω(n^2)`. Whether determinant (equivalently matrix multiply) is achievable in `n^{2+o(1)}` is the major open `ω = 2` question.

---

## 12. Summary

- **Definitions.** Leibniz (`Σ sgn(σ)∏A[i][σ(i)]`, `n!` terms) and cofactor expansion are equal (Theorem 2.1) but both `O(n!)`; neither is the algorithm.
- **Axioms.** `det` is the unique multilinear, alternating, normalized row function (Theorem 3.1). Every property — swap negates, row-add preserves, scale multiplies, `det(Aᵀ)=det(A)`, equal rows ⇒ `0`, non-additivity — follows.
- **Elimination.** `det(A) = (−1)^s ∏ U[i][i]`: row-adds (the workhorse) preserve `det`, swaps flip the sign, and the triangular `U` has determinant equal to its diagonal product (Theorem 5.1). This is `Θ(n^3)`.
- **Bareiss.** Fraction-free elimination whose every intermediate is a minor determinant (Sylvester's identity, Theorem 6.2), so the division is exact and magnitudes obey Hadamard — the exact-integer method without fractions.
- **Multiplicativity.** `det(AB)=det(A)det(B)` by the uniqueness argument (Theorem 7.1); implies `det(A^{-1})=1/det(A)`, similarity-invariance, and the consistency of the elimination pipeline.
- **Singularity.** `det(A)=0` ⇔ singular ⇔ dependent rows ⇔ rank `< n` (Theorem 8.1); over a ring, invertibility needs `det` to be a *unit* (`±1` over `ℤ`).
- **Modular / CRT.** `φ_p(det A) = det(φ_p A)` makes mod-`p` elimination exact (modular-inverse pivots); CRT over enough primes (`∏p > 2·Hadamard`) recovers the exact integer.
- **Matrix-tree.** `τ(G) = det(L_{ii})` (Kirchhoff, via Cauchy-Binet, Theorem 10.2), turning spanning-tree counting into one determinant; Cayley's `n^{n-2}` is the `K_n` special case.
- **Complexity.** Elimination `Θ(n^3)`, cofactor `Θ(n!)`, Hadamard bounds the bit-length, and `O(n^ω)` is achievable but rarely worth it.

### Complexity Cheat Table

| Task | Method | Complexity | Notes |
|------|--------|-----------|-------|
| `det` general | Gaussian elimination | `Θ(n^3)` field ops | product of pivots, sign per swap |
| `det` (theory only) | cofactor / Leibniz | `Θ(n!)` | test oracle for tiny `n` |
| `det` exact integer | Bareiss | `Θ(n^3)` ops | each on integers ≤ `(B√n)^n` |
| `det` mod `p` | `Z/pZ` elimination | `Θ(n^3)` | `O(1)` per op (fixed-width) |
| `det` exact via CRT | mod several primes + CRT | `Θ(n^3)` per prime | primes product `> 2·Hadamard` |
| `det` subcubic | block recursion | `O(n^ω)`, `ω<2.372` | rarely practical |
| spanning trees | matrix-tree (Laplacian minor) | `Θ(n^3)` | exact arithmetic required |
| solve `Ax = b` (Cramer) | `n+1` determinants | `Θ(n^4)` | symbolic; slower than direct solve |
| full char. polynomial | Faddeev-LeVerrier | `Θ(n^4)` | `det` is its constant term |

### Property Quick-Reference

| Property | Statement | Section |
|----------|-----------|---------|
| Triangular | `det(U) = ∏ U[i][i]` | 5 |
| Swap | `det` negates | 3, 4 |
| Row-add | `det` unchanged | 3, 4 |
| Scale row by `c` | `det` ×`c` | 3, 4 |
| Multilinear | linear in each row | 3 |
| Multiplicative | `det(AB) = det(A)det(B)` | 7 |
| Transpose | `det(Aᵀ) = det(A)` | 3 |
| Inverse | `det(A^{-1}) = 1/det(A)` | 7 |
| Scalar | `det(cA) = c^n det(A)` | 3 |
| Eigenvalues | `det(A) = ∏ λ_r` | 9b |
| Singular | `det = 0` ⇔ rank `< n` | 8 |
| Non-additive | `det(A+B) ≠ det(A)+det(B)` | 3 |

### Closing Notes

- The **uniqueness theorem** (Section 3) is the most economical foundation: it derives every property and proves `det(AB)=det(A)det(B)` without manipulating `n!` terms.
- **Sylvester's identity** (Section 6) is the precise reason Bareiss divisions are exact — the quotient is *always* a minor determinant, an element of the ring.
- **Cauchy-Binet** (Section 10) is the precise reason the matrix-tree determinant counts spanning trees — each maximal-minor square is `1` exactly for a tree.
- **Hadamard's bound** (Section 11) is the precise reason exact-integer determinants are *feasible*: the answer (and every Bareiss intermediate) has only polynomially many bits in `n` and `log B`.

Foundational references: Leibniz/cofactor equivalence and the axiomatic determinant in any linear-algebra text (Strang; Axler, *Linear Algebra Done Right*); Bareiss (1968) for fraction-free elimination and Sylvester's identity; Hadamard's inequality; Cauchy-Binet and Kirchhoff's matrix-tree theorem in algebraic graph theory (Biggs; Stanley, *Enumerative Combinatorics*); the Chinese Remainder Theorem (siblings `05-crt`, `15-garner-algorithm`). Sibling topics: `17-gaussian-elimination`, `19-matrix-rank`, `06-extended-euclidean-modular-inverse`.
