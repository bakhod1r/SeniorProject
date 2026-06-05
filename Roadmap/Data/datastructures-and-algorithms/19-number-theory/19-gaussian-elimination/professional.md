# Gaussian Elimination — Mathematical Foundations and Correctness

## Table of Contents
1. Formal Setup and Definitions
2. Row Operations Preserve the Solution Set (Correctness)
3. Existence and Uniqueness: The Rouché–Capelli Theorem
4. Row-Echelon and Reduced Row-Echelon Form (Uniqueness of RREF)
5. Elimination as Factorization: PA = LU
6. The Determinant as the Product of Pivots
7. Pivoting and Numerical Stability (Growth Factor)
8. Exact Elimination over a Field: `Z/pZ` and GF(2)
9. Fraction-Free (Bareiss) Elimination
10. Complexity: `O(n³)` and Its Limits
11. Summary

---

## 1. Formal Setup and Definitions

Let `F` be a field (the rationals `ℚ`, the reals `ℝ`, the finite field `Z/pZ` for prime `p`, or `GF(2)`). Let `A ∈ F^{m×n}` and `b ∈ F^m`. The **linear system** is

```
A·x = b,   x ∈ F^n.
```

**Definition 1.1 (Augmented matrix).** `[A | b] ∈ F^{m×(n+1)}` is `A` with `b` appended as column `n`.

**Definition 1.2 (Elementary row operations).** Three operations on the rows of a matrix:
1. **Swap** rows `i` and `j` (denote `Sᵢⱼ`).
2. **Scale** row `i` by a non-zero `c ∈ F` (denote `Mᵢ(c)`, `c ≠ 0`).
3. **Add** `c` times row `j` to row `i`, `i ≠ j` (denote `Eᵢⱼ(c)`).

Each is realized by left-multiplication by an **elementary matrix** `E` (an invertible `m×m` matrix obtained by applying the operation to `Iₘ`).

**Definition 1.3 (Row-echelon form, REF).** A matrix is in REF if (a) all zero rows are at the bottom, and (b) the leading non-zero entry (the **pivot**) of each non-zero row is strictly to the right of the pivot of the row above it. Consequently all entries below a pivot are zero.

**Definition 1.4 (Reduced row-echelon form, RREF).** REF with additionally (c) every pivot equals `1`, and (d) each pivot is the only non-zero entry in its column.

**Definition 1.5 (Rank).** `rank(A)` is the number of pivots in any REF of `A`; equivalently the dimension of the row space (= column space) of `A`. Section 4 shows this is well-defined.

**Notation.** Throughout, `m` = number of equations (rows), `n` = number of unknowns (columns), `r = rank(A)`, and `Iₖ` the `k×k` identity. "Pivot column" = a column containing a pivot; "free column" = one without.

---

## 2. Row Operations Preserve the Solution Set (Correctness)

This is the theorem that makes Gaussian elimination *correct*: transforming `[A|b]` by row operations does not change the set of `x` satisfying the system.

The three operations of Definition 1.2 are precisely the operations a human performs when "solving by substitution", made formal. The central claim of this section is that they never change the solution set — the property that makes the algorithm *correct* rather than merely *suggestive*.

**Lemma 2.1 (Elementary matrices are invertible).** Each elementary matrix `E` is invertible, with inverse itself an elementary matrix: `Sᵢⱼ⁻¹ = Sᵢⱼ`, `Mᵢ(c)⁻¹ = Mᵢ(1/c)`, `Eᵢⱼ(c)⁻¹ = Eᵢⱼ(−c)`.

**Proof.** Direct: applying the inverse operation undoes the operation, and the corresponding matrix product is `Iₘ`. Each requires only that `F` is a field (so `1/c` exists for `c ≠ 0`). ∎

**Theorem 2.2 (Invariance of the solution set).** Let `E` be any product of elementary matrices (hence invertible). Then `x` solves `A·x = b` if and only if `x` solves `(EA)·x = (Eb)`.

**Proof.** If `A·x = b`, left-multiply by `E`: `(EA)·x = E(A·x) = Eb`. Conversely, if `(EA)·x = Eb`, left-multiply by `E⁻¹` (which exists by Lemma 2.1): `A·x = E⁻¹(EA)x = E⁻¹(Eb) = b`. Thus the solution sets are equal. ∎

**Corollary 2.3.** Forward elimination, which is a sequence of elementary row operations on `[A|b]`, produces a system with *exactly the same* solutions. Reading the solution off the echelon form (back substitution) therefore solves the original system. This is the formal justification of the entire algorithm.

It is worth pausing on why this is non-trivial. Each elimination step *visibly changes the numbers* in the matrix, yet provably leaves the solution set fixed. The guarantee comes entirely from invertibility (Lemma 2.1): an invertible linear map carries the solution set bijectively to itself. Drop invertibility — for instance, "add a row to itself" scaled by `0`, or multiply a row by `0` — and the guarantee fails, which is exactly why `Mᵢ(c)` requires `c ≠ 0`. The discipline of using only the three legal operations is what keeps the algorithm honest.

**Remark.** The theorem requires only field axioms — division by a non-zero scalar (`Mᵢ(c)`, and the implicit division by the pivot during elimination). Over a commutative ring that is not a field, one must avoid division: Section 9 (Bareiss) does exactly that.

### 2.1 Worked Invariance Example

Consider the `2×2` system with solution `(x₀, x₁) = (1, 2)`:

```
[ 1  1 | 3 ]      (R0: x₀ + x₁ = 3)
[ 2  1 | 4 ]      (R1: 2x₀ + x₁ = 4)
```

Apply `E₁₀(−2)` (subtract `2·R0` from `R1`): the matrix becomes

```
[ 1  1 |  3 ]
[ 0 -1 | -2 ]
```

The original `R1` claimed `2x₀ + x₁ = 4`; the new `R1` claims `−x₁ = −2`. Both are satisfied by `(1, 2)` — and only by it together with `R0`. The elementary matrix used is

```
E₁₀(−2) = [ 1  0 ]    with inverse  [ 1  0 ]
          [-2  1 ]                  [ 2  1 ]
```

Left-multiplying the augmented matrix by `E₁₀(−2)` produces the eliminated form; left-multiplying by its inverse recovers the original. Because the map is a bijection on `F²` carrying solutions to solutions, the solution set is identical — the abstract content of Theorem 2.2 made concrete.

### 2.2 The Three Operations as Matrix Products

Every forward-elimination run is one big left-multiplication. For an `n×n` system the full reduction to `U` is

```
U = Eₖ Eₖ₋₁ ⋯ E₂ E₁ · (PA),
```

where each `Eᵢ` is an elementary lower-triangular `Eᵣⱼ(c)` and `P` collects the swaps. Setting `L⁻¹ = Eₖ⋯E₁` gives `L⁻¹ PA = U`, i.e. `PA = LU` (Section 5). The point for *correctness* is only that each `Eᵢ` and `P` is invertible (Lemma 2.1), so the composite is invertible and Theorem 2.2 applies to the whole run at once: the final triangular system has exactly the solutions of the original.

---

## 3. Existence and Uniqueness: The Rouché–Capelli Theorem

The pivot structure of the echelon form decides whether the system has zero, one, or infinitely many solutions.

**Theorem 3.1 (Rouché–Capelli).** The system `A·x = b` (over a field `F`) is **consistent** (has at least one solution) if and only if

```
rank(A) = rank([A | b]).
```

When consistent, the solution set is an affine subspace of dimension `n − rank(A)`. In particular:
- **Unique** solution `⟺ rank(A) = rank([A|b]) = n`.
- **Infinitely many** (over infinite `F`) / exactly `|F|^{n−r}` (over finite `F`) `⟺ rank(A) = rank([A|b]) = r < n`.
- **No** solution `⟺ rank(A) < rank([A|b])`.

**Proof.** Reduce `[A|b]` to REF by Theorem 2.2 (solution set preserved). Two cases for the augmented column:

*Inconsistent case.* If, after reduction, some row is `(0, …, 0 | c)` with `c ≠ 0`, it encodes `0 = c`, which has no solution; here the pivot in column `n` of `[A|b]` is *not* a pivot of `A`, so `rank([A|b]) = rank(A) + 1 > rank(A)`. No solution.

*Consistent case.* Otherwise no such row exists, so the augmented column is not a pivot column and `rank([A|b]) = rank(A) = r`. The `r` pivot columns correspond to **basic variables**; the `n − r` free columns to **free variables**. Assign the free variables arbitrary values in `F`; each pivot row then determines its basic variable uniquely by back substitution (the pivot entry is non-zero, hence invertible in `F`). Thus solutions exist and are parameterized by the `n − r` free variables: the solution set is `{x₀ + Σ tᵢ vᵢ : tᵢ ∈ F}`, where `x₀` is a particular solution and `{vᵢ}` is a basis of the null space `ker(A)` of dimension `n − r` (rank–nullity theorem). Uniqueness holds iff there are no free variables, i.e. `r = n`. ∎

**Corollary 3.2 (Rank–nullity).** `dim ker(A) = n − rank(A)`. The free variables index a basis of `ker(A)`; the homogeneous system `A·x = 0` is always consistent (`x = 0`) with solution space of dimension `n − r`.

**Why the homogeneous and inhomogeneous cases align.** The general solution of `A·x = b` is `x₀ + ker(A)`: pick any particular `x₀` satisfying the system, and the *complete* set of solutions is `x₀` plus every kernel vector. This is the affine-subspace structure of Theorem 3.1: the "shape" of the solution set (a point, a line, a plane, …) is the kernel `ker(A)`, and `b` merely *translates* it away from the origin. If `b` is inconsistent with the row space, no translation exists and the set is empty. This decomposition — particular + homogeneous — is why solving `A·x = 0` (for the kernel basis) and finding one `x₀` together describe *all* solutions, and it is exactly what a solver reports when `rank < n`.

**Corollary 3.3 (Square case).** For `m = n`, the following are equivalent: `A` is invertible; `det(A) ≠ 0` (Section 6); `rank(A) = n`; `A·x = b` has a unique solution for every `b`; `A·x = 0` has only `x = 0`. This connects the solver to sibling `18-matrix-determinant` (det test) and `19-matrix-rank` (rank test).

### 3.1 Worked Rouché–Capelli: the Three Outcomes

Three `2`-unknown systems, same `A`-shape, illustrating each verdict.

**Unique.** `x + y = 2`, `x − y = 0`. Reduce:

```
[ 1  1 | 2 ]      [ 1  1 | 2 ]
[ 1 -1 | 0 ]  →   [ 0 -2 | -2 ]
```

`rank(A) = rank([A|b]) = 2 = n`. Back-substitute: `y = 1`, `x = 1`. Unique.

**No solution.** `x + y = 2`, `2x + 2y = 5` (parallel, inconsistent):

```
[ 1  1 | 2 ]      [ 1  1 | 2 ]
[ 2  2 | 5 ]  →   [ 0  0 | 1 ]
```

The bottom row reads `0 = 1`. Here `rank(A) = 1` but `rank([A|b]) = 2`: the augmented column became a pivot. By Theorem 3.1, inconsistent — no solution.

**Infinitely many.** `x + y = 2`, `2x + 2y = 4` (same line):

```
[ 1  1 | 2 ]      [ 1  1 | 2 ]
[ 2  2 | 4 ]  →   [ 0  0 | 0 ]
```

`rank(A) = rank([A|b]) = 1 < 2 = n`. Column `y` has no pivot, so `y` is free: `x = 2 − y` for any `y ∈ F`. Over `ℝ` that is a line of solutions; over `Z/pZ` exactly `p^{2−1} = p` of them (Proposition 8.2). The general solution is `(2, 0) + t·(−1, 1)`, `t ∈ F`, with `(−1, 1)` spanning `ker(A)` (Corollary 3.2).

### 3.2 The Null Space and the Affine Solution Set

When `rank(A) = r < n`, the solution set of `A·x = b` is the **affine subspace** `x₀ + ker(A)`, where `x₀` is any particular solution and `ker(A) = {v : A·v = 0}` has dimension `n − r`. To build a basis of `ker(A)` from the RREF: for each free column `f`, set `x_f = 1`, all other free variables `0`, and solve the pivot rows for the basic variables. The resulting `n − r` vectors are linearly independent (each has a distinct free coordinate equal to `1` where the others are `0`) and span the kernel. This is the constructive content of the rank–nullity theorem and is exactly what Task 10 of [`tasks.md`](./tasks.md) asks you to produce over `Z/pZ`.

---

## 4. Row-Echelon and Reduced Row-Echelon Form (Uniqueness of RREF)

**Theorem 4.1 (Existence of RREF).** Every matrix `A ∈ F^{m×n}` can be transformed by elementary row operations into a matrix in RREF.

**Proof (constructive — the algorithm).** Process columns left to right, maintaining a current pivot row index `r` (initially `0`). For column `c`: if some row `≥ r` has a non-zero entry in column `c`, swap it to row `r` (`Sᵢⱼ`), scale row `r` so the pivot is `1` (`Mᵣ(1/pivot)`), and use `Eᵢᵣ(−aᵢc)` to zero column `c` in every other row `i ≠ r`; increment `r`. If no such row, column `c` is free; skip it. After all columns, the result satisfies Definition 1.4. Termination is immediate: each column is handled once, `r` only increases. ∎

**Theorem 4.2 (Uniqueness of RREF).** The RREF of `A` is **unique** — independent of the sequence of row operations used.

**Proof sketch.** Row operations preserve the **row space** of `A` (each new row is a linear combination of old rows, invertibly). The RREF pivot columns are determined by the row space: column `c` is a pivot column iff it is *not* in the span of the earlier columns (a property of `A`, not of the operations). Given the pivot columns, the RREF entries are the unique coordinates of each column in the basis formed by the pivot columns. Hence the RREF is unique. (A full proof appears in any linear-algebra text; the key fact is that RREF is a *canonical form* for the row-equivalence relation.) ∎

**Corollary 4.3 (Rank is well-defined).** Since the RREF is unique, the number of pivots — `rank(A)` — does not depend on the elimination path. This justifies Definition 1.5 and the rank computation of sibling `19-matrix-rank`.

**Remark (REF is not unique).** Only the *reduced* form is canonical; plain REF depends on pivot choices and scalings. But the *set of pivot columns* and the rank are invariant across all REFs.

### 4.1 Worked RREF and Pivot Columns

Reduce

```
[ 1  2  1 | 4 ]
[ 2  4  3 | 9 ]
[ 1  2  2 | 5 ]
```

Pivot col 0 (row 0). Clear below: `R1 ← R1 − 2R0 = [0, 0, 1 | 1]`, `R2 ← R2 − R0 = [0, 0, 1 | 1]`. Column 1 has *no* pivot at or below row 1 (both entries are `0`), so **column 1 is a free column** — advance to column 2 without consuming a pivot row. Pivot col 2 = row 1 (value `1`). Clear: `R0 ← R0 − R1 = [1, 2, 0 | 3]`, `R2 ← R2 − R1 = [0, 0, 0 | 0]`. RREF:

```
[ 1  2  0 | 3 ]
[ 0  0  1 | 1 ]
[ 0  0  0 | 0 ]
```

Pivot columns are `{0, 2}`; column `1` is free. `rank = 2 < 3`, consistent (no `0 = c` row), so infinitely many solutions: `x₁` free, `x₀ = 3 − 2x₁`, `x₂ = 1`. The pivot columns `{0, 2}` are intrinsic to `A` (Theorem 4.2) — any valid elimination order finds the same set, which is why `rank` is well-defined.

### 4.2 Why Pivot Columns Are an Invariant

Column `c` is a pivot column iff column `c` of `A` is **not** in the span of columns `0 … c−1`. This is a property of the column space of `A`, independent of any row operations (row operations preserve linear dependence relations among columns). Hence the set of pivot columns — and therefore `rank` — is determined by `A` alone. Different elimination *orders* or *scalings* produce different REF *entries*, but never a different set of pivot columns. This invariance is the rigorous foundation for the rank computation of sibling `19-matrix-rank` and for the free-variable bookkeeping every solver relies on.

---

## 5. Elimination as Factorization: PA = LU

Forward elimination (without the back-substitution / above-pivot clearing) is exactly an `LU` factorization with row pivoting.

**Theorem 5.1 (LU with partial pivoting).** For any `A ∈ F^{n×n}`, Gaussian elimination with partial pivoting produces a permutation matrix `P`, a unit lower-triangular `L` (ones on the diagonal, multipliers below), and an upper-triangular `U` such that

```
P·A = L·U.
```

**Proof.** Each elimination step on column `c` is left-multiplication by an elementary lower-triangular matrix `Lc⁻¹` (subtracting multiples of the pivot row from rows below) preceded by a row swap `Pc`. Collecting swaps into `P` and the (suitably permuted) multipliers into `L`, the accumulated product of the elimination matrices is unit lower-triangular, and the final matrix `U` is upper-triangular. The standard derivation shows the permuted multipliers assemble into a single unit lower-triangular `L`. ∎

**Consequence (solve and reuse).** To solve `A·x = b`: permute `Pb`, forward-substitute `L·y = Pb` (`O(n²)`), back-substitute `U·x = y` (`O(n²)`). The `O(n³)` factorization is done once; each additional right-hand side costs only `O(n²)`. This is the formal reason never to re-eliminate per RHS and never to invert `A` to solve (Section 10, and senior `§6`).

### 5.1 Worked LU Example

Factor `A = [[2, 1], [4, 3]]` (no pivot swap needed, `|2| < |4|` would trigger one — we show the no-pivot derivation first to expose `L` and `U` cleanly).

Eliminate `R1`: multiplier `ℓ₁₀ = 4/2 = 2`, so `R1 ← R1 − 2·R0` gives `[0, 3 − 2] = [0, 1]`. Then

```
L = [ 1  0 ]      U = [ 2  1 ]      and  L·U = [ 2  1 ] = A.
    [ 2  1 ]          [ 0  1 ]                 [ 4  3 ]
```

The multiplier `2` is stored as `L[1][0]`; `U` is the triangular result. To solve `A·x = (3, 7)`: forward-substitute `L·y = (3, 7)` → `y₀ = 3`, `y₁ = 7 − 2·3 = 1`; back-substitute `U·x = (3, 1)` → `x₁ = 1`, `x₀ = (3 − 1)/2 = 1`. So `x = (1, 1)`, and a *second* right-hand side reuses the same `L`, `U` in `O(n²)`.

With **partial pivoting** the larger `4` would be swapped to the top, giving `P = [[0,1],[1,0]]` and a numerically safer `L` with `|ℓ| ≤ 1`. The factored identity becomes `PA = LU`; the only change to the solve is permuting `b` by `P` first.

### 5.2 Uniqueness of LU (with pivoting)

**Proposition 5.2.** If `A` is non-singular, the `PA = LU` factorization with a fixed pivoting rule is unique: given `P`, the unit-lower-triangular `L` and upper-triangular `U` are determined. **Proof.** If `LU = L'U'` with both `L, L'` unit lower-triangular and `U, U'` upper-triangular non-singular, then `L'⁻¹L = U'U⁻¹`. The left side is unit lower-triangular, the right side upper-triangular; a matrix that is both is the identity. Hence `L = L'` and `U = U'`. ∎ This is why the multipliers and pivots are well-defined data, suitable for caching and reuse across right-hand sides.

### 5.3 Worked Inverse via Gauss-Jordan

To invert `A = [[2, 1], [1, 1]]`, augment with the identity and reduce `[A | I]` to `[I | A⁻¹]`:

```
[ 2  1 | 1  0 ]        scale R0 by 1/2     [ 1  0.5 | 0.5  0 ]
[ 1  1 | 0  1 ]   →    R1 ← R1 − R0    →   [ 0  0.5 | -0.5 1 ]
                       scale R1 by 2,       [ 1  0 | 1  -1 ]
                       R0 ← R0 − 0.5·R1 →   [ 0  1 | -1  2 ]
```

The right half is `A⁻¹ = [[1, −1], [−1, 2]]`. Check: `A·A⁻¹ = [[2−1, −2+2], [1−1, −1+2]] = [[1,0],[0,1]] = I`. The inverse is `n` solves bundled into one `RREF` pass — but recall (Section 5.1) that to *solve* `A·x = b` you should never form the inverse; this construction is only for when the inverse itself is the deliverable.

---

## 6. The Determinant as the Product of Pivots

**Theorem 6.1.** If `P·A = L·U` from Gaussian elimination with partial pivoting, then

```
det(A) = (−1)^s · ∏_{i=1}^{n} U[i][i],
```

where `s` is the number of row swaps (the sign of the permutation `P`).

**Proof.** The determinant is multilinear and alternating, so: (1) swapping two rows multiplies `det` by `−1` (hence the `(−1)^s` factor); (2) adding a multiple of one row to another (`Eᵢⱼ(c)`) leaves `det` unchanged; (3) `det` of a triangular matrix is the product of its diagonal. Since elimination uses only operations (1)–(2) to reach the upper-triangular `U`, and `det(L) = 1` (unit triangular), `det(P)·det(A) = det(L)·det(U) = ∏ Uᵢᵢ`, and `det(P) = (−1)^s`. Rearranging gives the formula. ∎

**Corollary 6.2.** `A` is singular `⟺` some pivot is `0` `⟺` `det(A) = 0` `⟺` elimination cannot complete with a non-zero pivot in every column. This is the determinant test of sibling `18-matrix-determinant`, computed by the *same* elimination, in `O(n³)` rather than the `O(n·n!)` cofactor expansion.

**The determinant–rank–solvability triangle.** For a square `A`, three quantities computed by the *one* elimination are equivalent witnesses of invertibility:

- `det(A) ≠ 0` (no zero pivot) — the determinant test (sibling `18`);
- `rank(A) = n` (every column has a pivot) — the rank test (sibling `19`);
- `A·x = b` has a unique solution — the solver's verdict.

They are not three computations but three readouts of the same row reduction: the pivot product is the determinant, the pivot count is the rank, and a full set of pivots makes back substitution unique. This is why a single `O(n³)` elimination simultaneously answers "is it invertible?", "what is its rank?", and "solve it" — the unifying observation that ties this topic to siblings `18` and `19`.

**Remark (exact determinants).** Over `Z/pZ` the pivot product is exact mod `p`. For exact *integer* determinants, fraction-free Bareiss elimination (Section 9) yields the determinant as the final pivot directly, with controlled integer growth.

### 6.1 Worked Determinant via Pivots

Take the introduction's matrix `A = [[2, 1, −1], [−3, −1, 2], [−2, 1, 2]]`. Forward elimination (junior `§Step-by-Step`) used **one** row swap (rows 1 and 2 in column 1) and reached pivots `2`, `2`, `0.25` along the diagonal of `U`. Hence

```
det(A) = (−1)^1 · (2 · 2 · 0.25) = −1 · 1 = −1.
```

A cofactor expansion confirms `det(A) = −1`, but at `O(n·n!)` cost versus the `O(n³)` elimination. The lesson: the determinant is a *free by-product* of the same elimination used to solve — track the diagonal product and the swap parity.

### 6.2 Why Add-Multiple Preserves the Determinant

The step `Rᵢ ← Rᵢ + c·Rⱼ` (`i ≠ j`) corresponds to left-multiplication by `Eᵢⱼ(c)`, a triangular matrix with `1`s on the diagonal and a single off-diagonal `c`. Its determinant is the product of its diagonal, `= 1`. By multiplicativity `det(Eᵢⱼ(c)·A) = det(Eᵢⱼ(c))·det(A) = det(A)`. A row swap is `det(Sᵢⱼ) = −1`, and a scaling `det(Mᵢ(c)) = c`. Since forward elimination uses only swaps and add-multiples (never scalings) to reach `U`, the determinant changes only by the swap signs, giving the `(−1)^s ∏ Uᵢᵢ` formula. This is the algebraic backbone of sibling `18-matrix-determinant`.

### 6.3 A Subtle Sign Trap

If your implementation *scales* a pivot row to make the pivot `1` during forward elimination (a step toward RREF), you have applied `Mᵢ(1/pivot)`, which multiplies the determinant by `1/pivot`. To recover the true determinant you must then multiply back by that pivot — i.e. the product of the original pivots, not the scaled `1`s. The clean discipline is to compute the determinant from a *pure* forward elimination (swaps + add-multiples only, no scaling), reading the unscaled diagonal of `U` and the swap parity. Mixing scaling into the determinant path is a classic off-by-a-factor bug; keep the determinant computation and the RREF computation conceptually separate even when they share a loop.

---

## 7. Pivoting and Numerical Stability (Growth Factor)

Over `ℝ` in floating point, elimination is only as good as its pivots.

**Definition 7.1 (Growth factor).** `ρ = (max over all steps and entries of |a⁽ᵏ⁾ᵢⱼ|) / (max |aᵢⱼ|)`, the largest magnitude appearing during elimination relative to the input.

**Theorem 7.2 (Wilkinson backward-error bound).** Gaussian elimination with partial pivoting computes the *exact* solution of a perturbed system `(A + δA)·x̂ = b` with

```
‖δA‖∞ ≤ c(n) · ρ · u · ‖A‖∞,
```

where `u` is the unit roundoff and `c(n)` a low-degree polynomial in `n`. Thus the method is **backward stable** provided the growth factor `ρ` is modest.

**Why partial pivoting helps.** Choosing the largest-magnitude pivot forces every multiplier `|m[r][col]/m[col][col]| ≤ 1`, which bounds growth well in practice (worst case `ρ ≤ 2^{n−1}`, but such matrices are extremely rare). Without pivoting, a tiny pivot yields huge multipliers and `ρ` explodes, destroying accuracy (the `1e-18` example in middle `§Deeper Concepts`).

**Conditioning (forward error).** Even with backward stability, the *forward* error is governed by the **condition number** `κ(A) = ‖A‖·‖A⁻¹‖`:

```
‖x̂ − x‖ / ‖x‖  ≲  κ(A) · (backward error).
```

If `κ(A) ≈ 10^k`, expect to lose about `k` digits no matter how good the algorithm. Pivoting bounds the algorithm-induced (backward) error; conditioning is intrinsic to `A`. Full pivoting bounds `ρ` provably better (`ρ ≤ √n · (2·3^{1/2}···n^{1/(n−1)})^{1/2}`, sub-exponential) at higher search cost. This is the theory behind senior `§2`.

### 7.1 Worked Instability Example

Without pivoting, solve

```
[ 0.0001  1 | 1 ]
[ 1       1 | 2 ]
```

Pivot `0.0001`. Multiplier `= 1/0.0001 = 10000`. `R1 ← R1 − 10000·R0`: column-1 entry `1 − 10000 = −9999`, `b` entry `2 − 10000 = −9998`. In 4-significant-digit arithmetic both round so that back substitution yields `x₁ ≈ 1.000`, `x₀ = (1 − x₁)/0.0001`. If `x₁` rounds to exactly `1`, `x₀` computes as `0` — but the true answer is `x₀ ≈ 1.0001`. The small pivot amplified the rounding catastrophically.

**With partial pivoting** the larger `1` is swapped to the top: multiplier `0.0001`, `R1 ← R1 − 0.0001·R0`, and no significant digits are lost. The matrix here is *well-conditioned* (`κ ≈ 2.6`), so the only error source was the algorithm's pivot choice — exactly the error partial pivoting removes. Contrast with an ill-conditioned matrix, where even flawless pivoting cannot recover lost digits.

### 7.2 Backward vs Forward Error, Quantified

The bound `‖x̂ − x‖/‖x‖ ≲ κ(A)·(backward error)` decomposes the total error into two independent factors:

- **Backward error** `≈ ρ·u` — what the *algorithm* contributes. Partial pivoting keeps `ρ` small, so this is `≈ u` (machine epsilon, `~10⁻¹⁶` in double).
- **Condition number** `κ(A)` — what the *problem* contributes. A multiplier on the input perturbation, immune to algorithmic improvement.

A backward-stable algorithm (partial-pivot elimination) gives a solution that is the *exact* answer to a *nearby* problem `(A + δA)`. Whether that is a *good* answer to the *original* problem depends entirely on `κ(A)`. This is why a senior engineer estimates `κ` (or watches the smallest pivot, a cheap proxy) and reports untrustworthy results rather than returning silent noise — the failure mode catalogued in senior `§9.2`.

---

## 8. Exact Elimination over a Field: `Z/pZ` and GF(2)

**Proposition 8.1 (Field correctness).** All of Sections 2–6 hold verbatim over any field `F`, because they use only field axioms (associativity, distributivity, and inverses of non-zero elements). In particular, over `Z/pZ` with `p` prime — a field by sibling `02`/`04` — Gaussian elimination is **exact**: no rounding, no growth factor, no conditioning.

**Pivot selection over a field.** Stability is irrelevant; the *only* requirement is a non-zero pivot, which is automatically invertible (every non-zero element of a field has an inverse). "Division by the pivot" is multiplication by `pivot⁻¹`, computed by Fermat (`pivot^{p−2} mod p`, sibling `04`) or the extended Euclidean algorithm (sibling `06`).

**Proposition 8.2 (Solution count over a finite field).** If `A·x = b` is consistent over `Z/pZ` with `rank(A) = r` and `n` unknowns, the number of solutions is exactly `p^{n−r}` (each of the `n − r` free variables ranges over all `p` field elements independently). Over `GF(2)` this is `2^{n−r}`. (Specializes Theorem 3.1 to finite `F`.)

**GF(2) specialization.** `GF(2) = Z/2Z`: addition is XOR, multiplication is AND, the unique non-zero element `1` is its own inverse. Elimination needs no inverse computation — just XOR the pivot row into every other row with a `1` in the pivot column. Because a row is a bit vector, this vectorizes over machine words (`O(n³/w)`, middle `§GF(2)`), and the structure is identical to the **XOR basis** of sibling `18-bit-manipulation`: maintaining one reduced basis vector per distinct leading bit is online GF(2) row reduction.

### 8.1 Worked Mod-p Elimination

Solve `A·x = b` over `Z/7Z` with `A = [[2, 3], [1, 1]]`, `b = [1, 4]`:

```
[ 2  3 | 1 ]
[ 1  1 | 4 ]
```

Pivot at row 0, value `2`. Its inverse mod 7: `2·4 = 8 ≡ 1`, so `2⁻¹ ≡ 4`. Eliminate row 1: factor `= m[1][0]·2⁻¹ = 1·4 = 4`. `R1 ← R1 − 4·R0 (mod 7)`:

```
col0: 1 − 4·2 = 1 − 8 ≡ 1 − 1 = 0   (mod 7)
col1: 1 − 4·3 = 1 − 12 ≡ 1 − 5 = −4 ≡ 3
b:    4 − 4·1 = 0
```

giving `[0, 3 | 0]`, so `3·x₁ ≡ 0` → `x₁ = 0`. Back-substitute row 0: `2·x₀ + 3·0 ≡ 1` → `x₀ ≡ 1·2⁻¹ = 4`. Solution `(x₀, x₁) = (4, 0)` over `Z/7Z`. Check: `2·4 + 3·0 = 8 ≡ 1` ✓, `4 + 0 = 4` ✓. Every step is exact integer arithmetic mod `7`; no rounding can occur because `Z/7Z` is a finite field.

### 8.2 Worked GF(2) Elimination

Solve `x₀ ⊕ x₁ = 1`, `x₁ ⊕ x₂ = 0`, `x₀ ⊕ x₂ = 1` over GF(2):

```
[ 1 1 0 | 1 ]
[ 0 1 1 | 0 ]
[ 1 0 1 | 1 ]
```

Pivot col 0 = row 0. XOR R0 into R2 (which has a `1` in col 0): `R2 = [1⊕1, 0⊕1, 1⊕0 | 1⊕1] = [0, 1, 1 | 0]`. Pivot col 1 = row 1. XOR R1 into R0 and R2 (both have `1` in col 1): `R0 = [1, 0, 1 | 1]`, `R2 = [0, 0, 0 | 0]`. Row 2 is all-zero with `b = 0` — consistent, and column 2 has no pivot, so `x₂` is **free**. With `x₂ = 0`: `x₁ = 0` (from R1: `x₁ ⊕ x₂ = 0`), `x₀ = 1` (from R0: `x₀ ⊕ x₂ = 1`). Solution count `= 2^{n−rank} = 2^{3−2} = 2` (Proposition 8.2): `(1,0,0)` and `(0,1,1)`. Every "addition" was an XOR; no inverse was ever computed.

**Composite moduli.** Over `Z/mZ` with `m` composite, `Z/mZ` is *not* a field: a non-zero pivot may be a zero divisor (non-invertible). Theorems 2–6 can fail. Remedies: factor `m = ∏ pᵢ^{eᵢ}`, solve modulo each prime power, recombine by CRT (sibling `05`/`15`); or use fraction-free Bareiss (Section 9) to avoid division entirely.

---

## 9. Fraction-Free (Bareiss) Elimination

Standard elimination over `ℚ` introduces fractions whose numerators/denominators can grow exponentially. **Bareiss elimination** stays in the integers.

**Theorem 9.1 (Bareiss / Sylvester identity).** Define `a⁽⁰⁾ᵢⱼ = aᵢⱼ` and the update

```
a⁽ᵏ⁾ᵢⱼ = ( a⁽ᵏ⁻¹⁾ₖₖ · a⁽ᵏ⁻¹⁾ᵢⱼ − a⁽ᵏ⁻¹⁾ᵢₖ · a⁽ᵏ⁻¹⁾ₖⱼ ) / a⁽ᵏ⁻²⁾_{(k−1)(k−1)},
```

with `a⁽⁻¹⁾₀₀ = 1`. Then every `a⁽ᵏ⁾ᵢⱼ` is an **exact integer** (it equals a `(k+1)×(k+1)` minor of `A`), and the division is exact.

**Proof idea.** Each intermediate Bareiss entry is, by the Sylvester determinant identity, a minor of the original matrix. Minors of an integer matrix are integers; hence the division by the previous pivot (itself a smaller minor) is exact integer division. The full induction is in the references. ∎

**Consequence.** Bareiss computes an exact integer determinant as the final pivot, and solves integer/rational systems with **polynomially bounded** entry growth (no exponential blow-up of fractions). It needs no field inverses, so it works over any integral domain — the method of choice for exact integer determinants (sibling `18`) and rational reconstruction (with sibling `16-continued-fractions`).

### 9.1 Worked Bareiss Step

Take `A = [[2, 3], [4, 5]]` (true `det = 2·5 − 3·4 = −2`). Bareiss with `prevPivot = 1`:

```
m[1][1] = (m[0][0]·m[1][1] − m[1][0]·m[0][1]) / prevPivot
        = (2·5 − 4·3) / 1 = (10 − 12)/1 = −2.
```

The final pivot `m[1][1] = −2` *is* the determinant — computed with one exact integer division (by `1` here), no fractions, no float. For a `3×3` the second elimination round divides by the previous pivot (here `2`), and the Sylvester identity guarantees that division is exact because every intermediate is a `2×2` minor of the original integer matrix. Entry magnitudes stay bounded by Hadamard's inequality on minors, `≈ (n^{1/2} · max|aᵢⱼ|)^n`, which is `O(n log n)` bits — polynomial, unlike the exponential denominator growth of naive rational elimination. This is precisely Task 12 of [`tasks.md`](./tasks.md).

### 9.2 Bareiss vs Modular vs Float — When Each Wins

| Goal | Method | Why |
|------|--------|-----|
| Exact integer determinant | Bareiss | no fractions, polynomial growth, final pivot is `det` |
| Determinant / solve mod prime | modular elimination | `O(1)` field ops, exact mod `p` |
| Exact rational solution | modular + rational reconstruction (sibling `16`) | recover `num/den` from a residue |
| Exact answer exceeding one prime | multi-prime + CRT (siblings `05`, `15`) | reconstruct large integer |
| Approximate real solution | float + partial pivoting | fast, backward stable if well-conditioned |

The unifying point: the *algorithm* (eliminate, track pivots) is identical; only the *arithmetic domain* and the *division rule* change. Field domains divide by the inverse; integral domains (Bareiss) divide exactly by the previous pivot; floats divide approximately and need pivoting for stability.

### 9.3 Entry-Growth Bound (Why Bareiss Stays Polynomial)

**Proposition 9.2.** Every Bareiss intermediate `a⁽ᵏ⁾ᵢⱼ` is a `(k+1)×(k+1)` minor of `A`. By **Hadamard's inequality**, a `d×d` minor of an integer matrix with entries bounded by `M` has magnitude at most `d^{d/2} · M^d`. Hence the largest Bareiss entry has `O(n log n + n log M)` bits — **polynomial** in the input size.

**Contrast with naive rational elimination.** If you carry fractions in lowest terms, the denominators can be products of `O(n)` pivots, and *numerators and denominators each grow exponentially* in the worst case (the classic "intermediate expression swell"). Bareiss's exact-division trick collapses this swell: because each step divides out the previous pivot exactly, the representation never accumulates uncancelled common factors. This is why a computer-algebra system computes a `100×100` integer determinant with Bareiss in seconds, while naive fraction arithmetic would drown in million-digit intermediates. The polynomial bound is the formal guarantee behind that practical win, and the reason Bareiss — not naive rational elimination — is the exact-integer default (sibling `18-matrix-determinant`).

---

## 10. Complexity: `O(n³)` and Its Limits

**Theorem 10.1.** Gaussian elimination on an `n×n` system performs `(2/3)n³ + O(n²)` field operations for forward elimination and `O(n²)` for back substitution, hence `Θ(n³)` total. RREF (Gauss-Jordan) is `Θ(n³)` with a larger constant (`n³` vs `(2/3)n³`).

**Proof.** Eliminating column `c` updates rows `c+1 … n` (about `n − c` rows), each over columns `c … n` (about `n − c` entries): `(n−c)²` multiply-adds. Summing `Σ_{c=0}^{n−1}(n−c)² = Σ_{k=1}^{n} k² = n(n+1)(2n+1)/6 ≈ n³/3`, and each entry is one multiply + one add, giving `(2/3)n³`. Back substitution is `Σ (n−i) = O(n²)`. ∎

**Lower bounds and fast multiply.** Solving a system is at least as hard as matrix-vector work `Ω(n²)` (reading the input). The connection to matrix multiplication gives subcubic *theoretical* algorithms: since LU/inversion is equivalent (up to constants) to matrix multiplication, one can solve in `O(n^ω)` with `ω < 2.3716` using fast multiplication (Strassen and successors), but these are numerically delicate and only win for large `n`. For practical sizes, blocked `O(n³)` with BLAS dominates.

**Field-specific costs.**

| Field | Per-op cost | Total | Speedup |
|-------|-------------|-------|---------|
| `ℝ` (double) | `O(1)` | `O(n³)` | BLAS / SIMD |
| `Z/pZ` | `O(1)` (mod) | `O(n³)` | Montgomery / Barrett (sibling `14`) |
| `GF(2)` | bit | `O(n³/w)` | bitsets (`w = 64`), M4RI |
| `ℚ` exact (Bareiss) | `O(M(L))` big-int | `O(n³ M(L))` | controlled growth `L = O(n log n)` |

**When `O(n³)` is too much.** Sparse systems use fill-reducing orderings and sparse direct solvers, or iterative methods (CG/GMRES) at `O(iterations · nnz)`; symmetric positive-definite systems use Cholesky at half the work. These are detailed at senior level (`§4`).

### 10.1 Worked Operation Count

For `n = 4`, forward elimination does, per column `c` (eliminating rows `c+1..3` over columns `c..4`):

```
c=0: 3 rows × 5 entries = 15 multiply-adds
c=1: 2 rows × 4 entries =  8
c=2: 1 row  × 3 entries =  3
total forward ≈ 26 ; back substitution ≈ 1+2+3 = 6 ; grand total ≈ 32.
```

The formula `Σ(n−c)² ≈ n³/3` gives `64/3 ≈ 21` for the dominant multiply term, and counting both multiply and add doubles it to `≈ 2n³/3`, consistent with the `(2/3)n³` headline. The lesson: the cost is *cubic and predictable*; doubling `n` multiplies the work by `≈ 8`, which is exactly why dense elimination caps out around `n` in the low thousands and motivates the field-specific (bitset, BLAS) and structural (sparse, iterative) accelerations.

### 10.2 RREF (Gauss-Jordan) Costs More Than REF

Gauss-Jordan clears entries *both above and below* each pivot, doing `≈ n` row updates per pivot across all `n` pivots: `≈ n · n · n = n³` multiply-adds, versus `(2/3)n³` for REF + back substitution. So for *solving*, prefer REF + back substitution; reserve full RREF (Gauss-Jordan) for computing inverses or reading the solution directly without a back-substitution pass. Both are `Θ(n³)`; the constant differs by `~1.5×`.

### 10.3 The Equivalence with Matrix Multiplication

**Theorem 10.2 (informal).** Matrix inversion, LU factorization, and matrix multiplication are equivalent up to constant factors and the exponent `ω`: if any can be done in `O(n^c)`, so can the others. **Consequence.** Using Strassen-style `O(n^ω)` multiply (`ω < 2.3716`), one can in principle factor/invert in `O(n^ω)`. In practice these fast methods are numerically delicate and only beat blocked `O(n³)` BLAS for very large `n` over the reals; over `Z/pZ` they are exact and more attractive at scale. The takeaway for this topic: the `Θ(n³)` of schoolbook elimination is *not* a fundamental lower bound (that is `Ω(n²)`), but it is the right practical default for the sizes graph and number-theory problems present.

### 10.4 Cost Across Fields, Side by Side

| Field | One row-op on a length-`ℓ` row | Total solve | Dominant constant |
|-------|-------------------------------|-------------|-------------------|
| Reals (`double`) | `ℓ` FLOPs | `(2/3)n³` FLOPs | FPU throughput; BLAS-bound |
| `Z/pZ` | `ℓ` modular mults | `(2/3)n³` modmults | the `%` / Montgomery cost |
| GF(2) (bitset) | `ℓ/64` word XORs | `(2/3)n³/64` word-ops | memory bandwidth |
| `ℚ` (Bareiss, big-int) | `ℓ · M(L)` | `(2/3)n³ · M(L)` | big-integer multiply `M(L)` |

The *shape* of the cost — cubic in `n` — is field-independent; the *per-element* cost is what each variant optimizes. GF(2)'s `1/64` factor and the reals' BLAS/SIMD throughput are the two largest practical wins, while Bareiss pays a big-integer premium in exchange for exactness without inverses.

---

## 11. Summary

- **Correctness (Section 2).** Elementary row operations are invertible (elementary matrices), so they preserve the solution set: `A·x = b ⟺ (EA)·x = Eb`. Back substitution on the echelon form therefore solves the original system. The only requirement is the field axioms.
- **Existence/uniqueness (Section 3).** Rouché–Capelli: consistent `⟺ rank(A) = rank([A|b])`; unique `⟺` that rank `= n`; otherwise `n − rank` free variables parameterize the solution space (rank–nullity). The pivot structure of the echelon form is the algorithmic witness — connecting to siblings `18` (det test) and `19` (rank).
- **Canonical form (Section 4).** RREF is unique; hence rank is well-defined regardless of the elimination path. Plain REF and pivot *choices* are not unique, but the pivot *columns* and rank are invariant.
- **Factorization (Section 5).** Elimination computes `PA = LU`; factor once (`O(n³)`), solve each right-hand side in `O(n²)`. Never invert `A` to solve.
- **Determinant (Section 6).** `det(A) = (−1)^s ∏ Uᵢᵢ` — the signed product of pivots — because row swaps flip the sign, add-multiple operations preserve `det`, and triangular determinants are diagonal products. This is sibling `18`'s `O(n³)` determinant.
- **Stability (Section 7).** Partial pivoting makes elimination backward stable by bounding the growth factor (multipliers `≤ 1`); the forward error is still governed by the intrinsic condition number `κ(A)`. Full pivoting bounds growth provably better at higher cost.
- **Exact fields (Section 8).** Over `Z/pZ` (prime) and `GF(2)` elimination is exact: divide by multiplying by the modular inverse; any non-zero pivot works; solution count over a finite field is `|F|^{n−r}`. GF(2) is XOR — the XOR basis of sibling `18-bit-manipulation`. Composite moduli need CRT or Bareiss.
- **Fraction-free (Section 9).** Bareiss elimination keeps all intermediates integral (each is a minor), with polynomial growth — the exact-integer determinant and rational-system solver.
- **Complexity (Section 10).** `Θ(n³)` (`(2/3)n³` for LU, `n³` for Gauss-Jordan); `O(n³/w)` for GF(2) bitsets; subcubic `O(n^ω)` is theoretical; sparse/iterative methods escape `O(n³)` when `A` is large and sparse.

### Theorem Reference Table

| Result | Statement | Section |
|--------|-----------|---------|
| Solution-set invariance | `A·x=b ⟺ (EA)x=Eb` for invertible `E` | 2 |
| Rouché–Capelli | consistent `⟺ rank(A)=rank([A|b])` | 3 |
| Rank–nullity | `dim ker(A) = n − rank(A)` | 3 |
| RREF uniqueness | RREF is a canonical form; rank well-defined | 4 |
| LU factorization | `PA = LU`, reuse for many RHS | 5 |
| Determinant = pivots | `det(A) = (−1)^s ∏ Uᵢᵢ` | 6 |
| Backward stability | partial pivoting bounds growth factor | 7 |
| Finite-field count | `|F|^{n−r}` solutions | 8 |
| Bareiss exactness | intermediates are integer minors | 9 |
| Complexity | `Θ(n³)` field ops | 10 |

### Closing Notes

- **One algorithm, many fields (Sections 2, 8, 9).** The correctness proof uses only the field axioms, so the *same* elimination is valid over `ℝ`, `Z/pZ`, and `GF(2)`. The only thing that changes is the division rule: by `1/pivot` (reals, with pivoting for stability), by `pivot⁻¹ mod p` (prime field), by XOR-only (GF(2), inverse is trivial), or by exact integer division by the previous pivot (Bareiss, no inverse). Recognizing which domain a problem lives in is the single most consequential modeling decision.
- **Rank is the universal classifier (Sections 3, 4).** Because the RREF — hence the pivot columns and rank — is a canonical invariant of `A`, the Rouché–Capelli verdict (no solution / unique / infinitely many) is well-defined and computable by the very elimination that solves the system. The free variables that remain are not a failure mode but a *parameterization* of the solution space, of dimension `n − rank`.
- **Factorization is the reuse story (Section 5).** Gaussian elimination is `PA = LU`; the factorization is the durable artifact. Solve once, reuse for every right-hand side at `O(n²)`, and read the determinant off the diagonal for free — never invert to solve.
- **Stability vs exactness is the central tension (Sections 7, 8).** Over the reals you fight rounding with pivoting and watch the condition number; over a field you have no rounding at all but must guard overflow and modulus structure. The two regimes share an algorithm and differ entirely in their failure modes — float elimination fails *silently* (ill-conditioning), field elimination fails *loudly* (a stalled pivot or an overflow), which is why exact methods are preferred whenever the problem permits them.
- **Connections to siblings.** The determinant (signed pivot product), the rank (pivot count), the modular inverse used at each pivot, the CRT/Garner recombination of multi-prime solves, the rational reconstruction via continued fractions, and the GF(2) XOR basis are all *the same elimination* viewed through different lenses — this topic is the hub that ties those siblings together.

Foundational references: Strang, *Linear Algebra and Its Applications* (elimination, RREF, the four subspaces); Trefethen & Bau, *Numerical Linear Algebra* (LU, pivoting, conditioning, Wilkinson's bound); Golub & Van Loan, *Matrix Computations*; Bareiss (1968) for fraction-free elimination; and sibling topics `02-modular-arithmetic`, `04-fermat-euler`, `05-crt`, `06-extended-euclidean-modular-inverse`, `15-garner-algorithm`, `16-continued-fractions`, `18-matrix-determinant`, `19-matrix-rank`, and `18-bit-manipulation` (XOR basis as GF(2) elimination).
