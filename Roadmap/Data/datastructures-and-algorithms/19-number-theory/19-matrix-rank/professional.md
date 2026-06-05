# Matrix Rank — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Rank Is Well-Defined: Row Rank Equals Column Rank (Proof)
3. Rank via Gaussian Elimination: Correctness
4. The Rank-Nullity Theorem (Proof)
5. Rouché-Capelli: Solvability of Linear Systems (Proof)
6. Counting Solutions over a Finite Field: 2^(n−rank) (Proof)
7. Rank over Different Fields: Reals, Z/pZ, GF(2)
8. Determinantal Characterization and Minors
9. Complexity: O(n²m), Fast Multiply, and Lower Bounds
10. Hardness Boundaries: Tensor and Non-Negative Rank
11. Applications: Codes, Spans, Independence
12. Summary

---

## 1. Formal Definitions

Let `F` be a field (e.g. `ℝ`, `ℚ`, `ℤ/pℤ` for prime `p`, or `GF(2)`) and let `A ∈ F^{m×n}` be an `m × n` matrix with rows `r₁, …, r_m ∈ F^n` and columns `c₁, …, c_n ∈ F^m`.

**Definition 1.1 (Linear independence).** Vectors `v₁, …, v_k ∈ F^d` are **linearly independent** if the only scalars `α₁, …, α_k ∈ F` with `α₁ v₁ + ⋯ + α_k v_k = 0` are `α₁ = ⋯ = α_k = 0`. Otherwise they are **dependent**. Independence is field-relative: the same vectors can be independent over `ℝ` and dependent over `GF(2)` (Section 7), because "the only combination giving zero is trivial" depends on which scalars `α_i` the field provides.

**Definition 1.2 (Row space, column space).** The **row space** `Row(A) ⊆ F^n` is the span of the rows; the **column space** `Col(A) ⊆ F^m` is the span of the columns. Note the row space lives in `F^n` (length-`n` rows) and the column space in `F^m` (length-`m` columns) — different ambient spaces, yet (Theorem 2.1) the same dimension.

**Definition 1.3 (Row rank, column rank).** The **row rank** is `dim Row(A)`; the **column rank** is `dim Col(A)`. Theorem 2.1 shows they are equal; their common value is the **rank**, `rank(A)` or `r(A)`.

**Definition 1.4 (Null space, nullity).** The **null space** (kernel) is `Null(A) = { x ∈ F^n : A x = 0 }`, a subspace of `F^n`. Its dimension is the **nullity**, `null(A) = dim Null(A)`.

**Definition 1.5 (Pivot / row-echelon form).** A matrix is in **row-echelon form (REF)** if (i) all zero rows are at the bottom, and (ii) the leading nonzero entry (the **pivot**) of each nonzero row is strictly to the right of the pivot in the row above. The pivots occupy the **pivot columns**; the remaining columns are **free columns**.

**Notation.** `I_n` is the `n × n` identity; `[A | b]` is the augmented matrix (`A` with column `b` appended); `e_i` is the `i`-th standard basis vector. Elementary row operations are: (R1) swap two rows, (R2) scale a row by a nonzero `α ∈ F`, (R3) add a multiple of one row to another. We write `rank(A)`, `null(A)`, `Row(A)`, `Col(A)`, `Null(A)` per Definitions 1.2–1.4; `χ_A`, `det`, and minors appear in Section 8; and `ω` denotes the matrix-multiplication exponent in Section 9. All vector spaces are over the fixed field `F` unless a specific field (`ℝ`, `GF(2)`, `ℤ/pℤ`) is named for contrast.

**Remark.** Working over a **field** (not merely a ring) is essential: every nonzero scalar has an inverse, so R2 and the elimination step are always valid. Over `ℤ/pℤ` this requires `p` prime (so it is a field); over a non-prime modulus `ℤ/mℤ` the structure is a ring with zero divisors and the clean theory below can fail.

**Definition 1.6 (Rank, unified).** By Theorem 2.1 the row rank and column rank coincide; their common value `rank(A)` is *the* rank. Equivalently it is the number of pivots in any row-echelon form (Theorem 3.2), the largest order of a nonzero minor (Theorem 8.2), and the dimension of both the row and column spaces. These characterizations are proven equal below and may be used interchangeably; each is the natural one for a different purpose (independence testing, elimination, symbolic rank, subspace dimension).

### 1.1 Independence, Made Concrete

For the three vectors `v₁ = (1,2,3)`, `v₂ = (2,4,6)`, `v₃ = (0,1,1)` in `ℝ³`: the relation `2 v₁ − v₂ = (0,0,0)` is a nontrivial dependence (coefficients `2, −1, 0`, not all zero), so `{v₁, v₂}` is dependent and any set containing both is dependent. But `{v₁, v₃}` is independent: `α v₁ + β v₃ = 0` forces `α = 0` (third-vs-first coordinate ratios disagree) and then `β = 0`. Thus the maximal independent subset has size 2, so the rank of the matrix with these rows is 2 — the same answer Section 3's elimination produces. Definition 1.1's "only the trivial combination gives zero" is exactly the property the pivot structure tests.

### 1.2 The Rank Function's Basic Properties

From the definitions alone, before any deep theorem:

- `rank(A) ≥ 0`, with `rank(A) = 0 ⇔ A = 0` (the zero matrix is the only rank-0 matrix).
- `rank(A) ≤ m` and `rank(A) ≤ n` (cannot exceed either dimension), hence `rank(A) ≤ min(m, n)`.
- Scaling the whole matrix by a nonzero scalar `c` leaves the rank unchanged: `rank(cA) = rank(A)` for `c ≠ 0`.
- Appending a zero row or zero column does not change the rank.
- Permuting rows or columns does not change the rank (a special case of Lemma 3.1's R1).

These are the "type-checking" sanity properties any correct implementation must satisfy, and they form the cheapest layer of the test battery in the senior file.

---

## 2. Rank Is Well-Defined: Row Rank Equals Column Rank (Proof)

**Theorem 2.1.** For every `A ∈ F^{m×n}`, the row rank equals the column rank.

**Proof.** Let `r =` row rank `= dim Row(A)`. Choose a basis `b₁, …, b_r ∈ F^n` of the row space and form the `r × n` matrix `B` with these rows, and the `m × r` matrix `C` such that each row `r_i` of `A` is a combination of the `b`'s: `r_i = Σ_{t=1}^r C[i][t] · b_t`. In matrix form this is the factorization

```
A = C · B,     C ∈ F^{m×r},  B ∈ F^{r×n}.
```

Now read this column-wise: column `j` of `A` is `c_j = C · (column j of B)`, a linear combination of the `r` columns of `C`. Hence **every column of `A` lies in the span of the `r` columns of `C`**, so

```
column rank = dim Col(A) ≤ r = row rank.
```

Applying the same argument to the transpose `Aᵀ` (whose row rank is `A`'s column rank and whose column rank is `A`'s row rank) gives the reverse inequality `row rank ≤ column rank`. Therefore row rank `=` column rank. ∎

**Corollary 2.2.** `rank(A) = rank(Aᵀ)`, and `rank(A) ≤ min(m, n)`.

**Remark (rank factorization).** The proof produced `A = C·B` with `C` of full column rank `r` and `B` of full row rank `r`. This **rank factorization** is the algebraic heart of rank: `rank(A)` is the smallest `r` for which `A` factors as (`m×r`)·(`r×n`). It immediately gives `rank(AB) ≤ min(rank(A), rank(B))` and underlies low-rank approximation.

### 2.1 Worked Verification of Theorem 2.1

Take the rank-deficient matrix

```
A = [ 1  2  3 ]
    [ 2  4  7 ]
    [ 1  2  4 ]
```

*Row rank.* Row 2 minus `2·`Row 1 is `(0, 0, 1)`; Row 3 minus Row 1 is `(0, 0, 1)` — the *same* vector. So after removing Row 1, Rows 2 and 3 are dependent: only `{Row 1, (0,0,1)}` are independent, giving **row rank 2**.

*Column rank.* Column 2 = `2·`Column 1, so Column 2 is dependent. Columns 1 and 3 are independent (no scalar makes `(1,2,1)` a multiple of `(3,7,4)`), giving **column rank 2**.

Row rank (2) = column rank (2), exactly as Theorem 2.1 promises. The rank factorization here is `A = C·B` with

```
C = [ 1  0 ]      B = [ 1  2  3 ]
    [ 2  1 ]          [ 0  0  1 ]
    [ 1  1 ]
```

and a quick multiply recovers `A`. `C` has full column rank 2; `B` has full row rank 2; their inner dimension `2` is the rank. This concrete factorization is the picture behind the abstract proof.

### 2.2 Why Working over a Field Matters

The proof scaled rows by `1/pivot` (implicitly, when choosing a basis). Over a **ring** with zero divisors — e.g. `ℤ/6ℤ`, where `2·3 = 0` — a nonzero entry need not be invertible, so elimination can stall and "row rank = column rank" can fail. The entire theory of this document assumes `F` is a field: `ℝ`, `ℚ`, `GF(2)`, or `ℤ/pℤ` with `p` **prime**. Using a composite modulus silently breaks the guarantees; this is the formal reason competitive-programming rank code always uses a prime modulus.

---

## 3. Rank via Gaussian Elimination: Correctness

**Lemma 3.1 (Elementary operations preserve rank).** Each elementary row operation (R1, R2, R3) leaves the row space — hence the rank — unchanged.

**Proof.** R1 (swap) permutes the spanning set, same span. R2 (scale by `α ≠ 0`) replaces `r_i` by `α r_i`; since `α` is invertible, `span(…, α r_i, …) = span(…, r_i, …)`. R3 (`r_i ← r_i + β r_j`) replaces `r_i` by `r_i + β r_j ∈ span(rows)`, and `r_i = (r_i + β r_j) − β r_j` is recoverable, so the span is unchanged. In all cases `Row(A)` is invariant, so `dim Row(A) = rank(A)` is invariant. The same holds for column operations on the column space. ∎

**Why `α ≠ 0` is essential (R2).** If we allowed `α = 0`, scaling a row to zero would *destroy* information: a rank-2 matrix could be turned into a rank-1 one. The invertibility of every nonzero field element is exactly what guarantees R2 is reversible and hence rank-preserving. This is another place the field assumption (every nonzero element has an inverse) is load-bearing — over a ring like `ℤ/6ℤ`, scaling by `2` (a zero divisor, `2·3 = 0`) is *not* invertible and can change the rank, breaking the lemma.

**The solution set is also preserved.** Beyond the row space, R1–R3 applied to the augmented `[A|b]` preserve the *solution set* of `A x = b`: each operation corresponds to multiplying both sides by an invertible elementary matrix `E`, and `EAx = Eb ⇔ Ax = b`. This is the formal justification that Gaussian elimination — used for solving (sibling `17`) and for rank — never gains or loses solutions, only re-expresses them.

**Theorem 3.2 (Pivots count the rank).** If Gaussian elimination reduces `A` to row-echelon form `U`, then the number of pivots (equivalently, the number of nonzero rows of `U`) equals `rank(A)`.

**Proof.** By Lemma 3.1, `rank(A) = rank(U)`. It remains to show the rank of an REF matrix `U` equals its number of nonzero rows, say `r`. *Independence of the nonzero rows:* suppose `Σ_{i=1}^{r} α_i u_i = 0`. Let column `j₁ < j₂ < ⋯ < j_r` be the pivot columns. Consider the leftmost pivot column `j₁`: only row `u₁` has a nonzero entry there (every other nonzero row's pivot is strictly to the right, and zero rows are zero), so the `j₁` coordinate of the sum is `α₁ · (pivot₁) = 0`, forcing `α₁ = 0`. Inductively, in pivot column `j_s` only rows `u_s, …` can be nonzero and `α₁ = ⋯ = α_{s-1} = 0` already, so `α_s · (pivot_s) = 0 ⇒ α_s = 0`. Thus all `α_i = 0`: the `r` nonzero rows are independent. They obviously span `Row(U)` (the zero rows add nothing). Hence `dim Row(U) = r`. Therefore `rank(A) = rank(U) = r =` number of pivots. ∎

**Corollary 3.3 (Algorithm correctness).** The "row-reduce and count pivots" algorithm returns `rank(A)` exactly. Over a field where arithmetic is exact (`ℚ`, `ℤ/pℤ`, `GF(2)`), the count is exact; over floating-point `ℝ` it is exact for the *rounded* matrix, which is why a tolerance is needed to recover the intended rank.

### 3.1 Worked Elimination Trace

Reduce the rank-deficient `A` of Section 2.1 and watch the pivots:

```
[ 1  2  3 ]   col 0: pivot in row 0 (entry 1). Eliminate below:
[ 2  4  7 ]     R1 -= 2·R0 → (0,0,1)
[ 1  2  4 ]     R2 -= 1·R0 → (0,0,1)

[ 1  2  3 ]   col 1: rows 1,2 both have 0 — NO pivot, skip.
[ 0  0  1 ]
[ 0  0  1 ]

[ 1  2  3 ]   col 2: pivot in row 1 (entry 1). Eliminate:
[ 0  0  1 ]     R2 -= 1·R1 → (0,0,0)   ← collapses to a ZERO ROW
[ 0  0  0 ]
```

Two pivots (columns 0 and 2), one zero row. `rank(A) = 2`. The zero row is the algorithmic manifestation of Row 3's dependence (it equalled `Row 0 + (Row 1 − 2·Row 0)`'s residual). Note that **column 1 was skipped** — it is a free (non-pivot) column, and `n − rank = 3 − 2 = 1` free column matches the single skip.

### 3.2 Uniqueness of the Reduced Row-Echelon Form

**Theorem 3.4.** Every matrix has a **unique** reduced row-echelon form (RREF), independent of the elimination order.

**Proof sketch.** The pivot columns are determined intrinsically: column `j` is a pivot column iff it is **not** in the span of the earlier columns `0, …, j−1` (equivalently, iff adding it raises the rank of the prefix). This characterization does not reference the elimination order, so the set of pivot columns is invariant. Given the pivot columns, the RREF entries are then forced (each pivot is `1`, each pivot column is otherwise `0`, and the free-column entries are the unique coordinates expressing free columns in the pivot-column basis). ∎ Consequently, while *which row operations* you perform may differ, the **rank** (number of pivots) and the **pivot-column set** are canonical — a reassurance that any correct implementation, in any order, yields the same rank.

---

## 4. The Rank-Nullity Theorem (Proof)

**Theorem 4.1 (Rank-Nullity).** For `A ∈ F^{m×n}`,

```
rank(A) + null(A) = n        (n = number of columns).
```

**Proof.** Reduce `A` to **reduced** row-echelon form `R` (pivots equal `1`, and each pivot column is zero except for its pivot). By Lemma 3.1, `Null(A) = Null(R)` (row operations preserve the solution set of `A x = 0`). Let `r = rank(A)` be the number of pivot columns; the other `n − r` columns are **free**.

Solving `R x = 0`: each **pivot variable** is expressed uniquely in terms of the free variables (from its pivot row), while each **free variable** may be chosen arbitrarily. For each free column `f`, set that free variable to `1` and all other free variables to `0`; the pivot variables are then determined, producing a solution vector `w_f ∈ Null(A)`. 

*The `w_f` are independent:* in the coordinate of free variable `f`, `w_f` has a `1` while every other `w_{f'}` has a `0`, so no nontrivial combination vanishes. *The `w_f` span `Null(A)`:* any solution `x` equals `Σ_f x_f · w_f`, because subtracting this combination zeroes every free coordinate and (since pivot variables are determined by the free ones) every pivot coordinate too. Hence `{ w_f }` is a basis of `Null(A)` of size `n − r`. Therefore `null(A) = n − r`, i.e. `rank(A) + null(A) = n`. ∎

**Corollary 4.2.** The homogeneous system `A x = 0` has a nonzero solution iff `rank(A) < n`. In particular a square `A ∈ F^{n×n}` is invertible iff `rank(A) = n` iff `null(A) = 0`.

**Corollary 4.3 (free-variable count).** A consistent system `A x = b` has exactly `n − rank(A)` free parameters in its solution set; this number is the dimension of the affine solution space (a translate of `Null(A)`).

### 4.1 Worked Null-Space Construction

Take the `2 × 4` matrix already in reduced row-echelon form:

```
R = [ 1  0  2  3 ]
    [ 0  1  4  5 ]
```

Pivot columns: `0` and `1` (rank `r = 2`). Free columns: `2` and `3`, so nullity `= 4 − 2 = 2`. Solving `R x = 0`:

```
x₀ = −2·x₂ − 3·x₃
x₁ = −4·x₂ − 5·x₃
x₂, x₃ free
```

Setting `(x₂, x₃) = (1, 0)` gives `w₁ = (−2, −4, 1, 0)`; setting `(x₂, x₃) = (0, 1)` gives `w₂ = (−3, −5, 0, 1)`. The `1`/`0` pattern in the free coordinates makes `w₁, w₂` independent, and every null-space vector is `x₂·w₁ + x₃·w₂`. So `{w₁, w₂}` is a basis of `Null(R)` of size `2 = n − rank`, confirming Theorem 4.1 constructively. Over `GF(2)` the same two vectors generate all `2² = 4` solutions (Theorem 6.1).

### 4.1b Verifying Rank-Nullity Numerically

For the matrix `A` of Section 2.1 (rank 2, `n = 3` columns), rank-nullity predicts `null(A) = 3 − 2 = 1`. Solving `A x = 0`: after reduction, column 1 is free; setting `x₁ = 1` and back-solving the pivot variables gives a single null-space vector `w = (−2, 1, 0)` (since `x₀ + 2x₁ = 0 ⇒ x₀ = −2`, and the pivot in column 2 forces `x₂ = 0`). Check: `A w = (1·(−2)+2·1+3·0, 2·(−2)+4·1+7·0, 1·(−2)+2·1+4·0) = (0, 0, 0)` ✓. Exactly one basis vector, matching `null = 1`. This entrywise check — pick the free variables, back-solve, confirm `A w = 0` — is the standard runtime assertion that validates a rank computation against rank-nullity (senior file, test battery).

### 4.2 Rank-Nullity as Dimension Counting

The theorem is, at heart, the **dimension theorem for linear maps**: viewing `A : F^n → F^m` as a linear map, `rank(A) = dim(image)` and `null(A) = dim(kernel)`, and `dim(domain) = dim(kernel) + dim(image)`. The domain has dimension `n` (the number of columns), which is why `n` — never `m` — appears in `rank + nullity = n`. This map-theoretic statement is the most robust way to remember the off-by-dimension trap: nullity lives in the *domain* `F^n`, rank measures the *image* in `F^m`, and the conservation law balances them against the domain dimension `n`.

---

## 5. Rouché-Capelli: Solvability of Linear Systems (Proof)

**Theorem 5.1 (Rouché-Capelli).** The system `A x = b` (with `A ∈ F^{m×n}`, `b ∈ F^m`) is **consistent** (has at least one solution) if and only if

```
rank(A) = rank([A | b]).
```

When consistent, the solution set is an affine subspace of dimension `n − rank(A)`; it is a **unique** solution iff additionally `rank(A) = n`.

**Proof.** `A x = b` has a solution iff `b` is a linear combination of the columns of `A`, i.e. iff `b ∈ Col(A)`. Appending `b` as a new column, `Col([A|b]) = Col(A) + span(b)`. Thus:

- If `b ∈ Col(A)`, appending it does not enlarge the column space, so `dim Col([A|b]) = dim Col(A)`, i.e. `rank([A|b]) = rank(A)`.
- If `b ∉ Col(A)`, then `b` is independent of `A`'s columns and `dim Col([A|b]) = dim Col(A) + 1`, i.e. `rank([A|b]) = rank(A) + 1`.

Since rank is column rank (Theorem 2.1), `A x = b` is consistent `⇔ b ∈ Col(A) ⇔ rank(A) = rank([A|b])`. 

For the dimension claim, assume consistency with particular solution `x₀` (so `A x₀ = b`). Then `A x = b ⇔ A(x − x₀) = 0 ⇔ x − x₀ ∈ Null(A)`, so the solution set is the coset `x₀ + Null(A)`, an affine subspace of dimension `null(A) = n − rank(A)` (Theorem 4.1). It is a single point iff `null(A) = 0 ⇔ rank(A) = n`. ∎

**Echelon-form view.** Row-reduce `[A|b]` to REF. Consistency fails exactly when a row `[0 0 ⋯ 0 | c]` with `c ≠ 0` appears — a "`0 = c`" contradiction — which is precisely the case `rank([A|b]) = rank(A) + 1` (the appended `b`-column gained a pivot). This is the computational test, and it ties directly to sibling `17-gaussian-elimination`.

**Corollary 5.2 (classification).**
- `rank(A) < rank([A|b])` → **no solution**.
- `rank(A) = rank([A|b]) = n` → **exactly one** solution.
- `rank(A) = rank([A|b]) < n` → **infinitely many** (infinite field) or `|F|^{n−rank}` (finite field).

### 5.1 Worked Solvability Cases

Consider three systems with the same `A` but different `b`, over `ℚ`:

```
A = [ 1  1 ]
    [ 2  2 ]
```

`rank(A) = 1` (Row 2 = `2·`Row 1). Now:

- **`b = (1, 2)`:** `[A|b]` has Row 2 = `2·`Row 1 still, so `rank([A|b]) = 1 = rank(A) < n = 2` → **infinitely many** solutions (a 1-parameter line). Indeed `x₀ + x₁ = 1` is the only constraint.
- **`b = (1, 3)`:** reducing `[A|b]` yields a row `(0, 0 | 1)` — the contradiction `0 = 1`. So `rank([A|b]) = 2 > 1 = rank(A)` → **no solution**.
- **`b = (0, 0)`:** always consistent (`x = 0` works), `rank([A|b]) = 1 < 2` → **infinitely many** (the homogeneous null space, dimension `2 − 1 = 1`).

Each case is decided purely by the rank comparison — no need to actually solve. This is the computational essence of Rouché-Capelli and ties directly to the echelon-form contradiction test in sibling `17-gaussian-elimination`.

### 5.1b The Contradiction Row, Algebraically

Why does inconsistency always surface as a `[0 ⋯ 0 | c]`, `c ≠ 0` row in REF of `[A|b]`? Because that row says `0·x₁ + ⋯ + 0·x_n = c`, an unsatisfiable equation. It appears exactly when `b`, after the same row operations that zero out a dependent combination of `A`'s rows, leaves a nonzero residue — i.e. when some left-null-space vector `cᵀ` of `A` (a row combination giving `cᵀA = 0`) has `cᵀb ≠ 0`. The **Fredholm alternative** states this crisply: `A x = b` is solvable iff `b` is orthogonal to every left-null-space vector (`cᵀb = 0` for all `c` with `cᵀA = 0`). Rouché-Capelli is the rank-counting face of the Fredholm alternative; the contradiction row is its computational witness. This duality — solvability of `Ax = b` versus the existence of a `cᵀA = 0` with `cᵀb ≠ 0` — is the linear-algebra prototype of LP duality and Farkas' lemma.

### 5.2 Consistency Is a Column-Space Membership Test

The deepest reading of Theorem 5.1: `A x = b` asks whether `b` is a **linear combination of the columns of `A`**, i.e. `b ∈ Col(A)`. The rank of `[A|b]` measures `dim(Col(A) + span{b})`. It equals `rank(A)` exactly when adding `b` contributes no new dimension — i.e. `b` was already in `Col(A)`. Thus "solvable" and "`b ∈ column space`" are the *same* statement, and rank is simply the dimension bookkeeping that detects it. This viewpoint generalizes verbatim to least-squares (project `b` onto `Col(A)` when `b ∉ Col(A)`), the standard remedy when a real-world system is inconsistent due to measurement noise.

---

## 6. Counting Solutions over a Finite Field: 2^(n−rank) (Proof)

**Theorem 6.1.** Let `F = GF(q)` (a finite field with `q` elements; `q = 2` for GF(2)), and suppose `A x = b` is **consistent** over `F`. Then the number of solutions is exactly

```
|{ x ∈ F^n : A x = b }| = q^{ n − rank(A) }.
```

For GF(2) this is `2^{n − rank(A)}`.

**Proof.** By Theorem 5.1, consistency gives a particular solution `x₀`, and the solution set is the coset `x₀ + Null(A)`. The map `w ↦ x₀ + w` is a bijection between `Null(A)` and the solution set, so

```
#solutions = |Null(A)|.
```

`Null(A)` is a subspace of `F^n` of dimension `d = null(A) = n − rank(A)` (Theorem 4.1). A `d`-dimensional vector space over `GF(q)` has a basis `w₁, …, w_d`, and **every** element is uniquely `Σ_{i=1}^{d} α_i w_i` with each `α_i ∈ F` ranging over all `q` values independently. Hence `|Null(A)| = q^d = q^{n − rank(A)}`. Combining, `#solutions = q^{n − rank(A)}`. ∎

**Corollary 6.2 (GF(2) special cases).** With `q = 2`: an inconsistent system has `0` solutions; a consistent system with `rank = n` has `2^0 = 1` (unique); a consistent system with `rank < n` has `2^{n − rank}` solutions, each free variable doubling the count. The `2^{n−rank}` factor is exactly the cardinality of the GF(2) null space, which is why it appears in XOR puzzles, linear cryptanalysis, and syndrome decoding.

**Generalization to GF(q).** For a prime power `q`, the identical argument over `GF(q)` gives `q^{n − rank}` solutions: each of the `n − rank` free variables ranges over all `q` field elements independently. So a consistent ternary (GF(3)) system with 4 unknowns and rank 2 has `3² = 9` solutions, and a GF(256) system (bytes, as in Reed-Solomon codes) with `n − rank = 3` free symbols has `256³ ≈ 1.6×10⁷` solutions. GF(2) is merely the most common instance; the rank-nullity machinery is field-uniform, which is why the *same* code computes solution counts for binary XOR puzzles and byte-oriented error-correcting codes alike.

**Application: counting "Lights Out" solutions.** In the Lights Out puzzle, pressing button `i` toggles a fixed set of lights (column `i` of a GF(2) matrix `A`); reaching a target configuration `b` from all-off is solving `A x = b` over GF(2), where `x_i` ∈ {0,1} records whether button `i` is pressed an odd number of times. The number of distinct press-sets achieving `b` is `0` (if inconsistent) or `2^{n − rank(A)}` — the dimension `n − rank` counts the **"quiet patterns"** (button-sets that toggle nothing, the null space). For the classic `5×5` board, `rank(A) = 23` over GF(2), so `n − rank = 25 − 23 = 2`: every solvable configuration has exactly `2² = 4` solutions, and `2²` quiet patterns exist. This is Theorem 6.1 made tangible — the entire solvability-and-counting structure of the puzzle is two rank numbers.

**Remark (homogeneous count).** Setting `b = 0` (always consistent, `x = 0` is a solution), the number of solutions to `A x = 0` over `GF(q)` is `q^{n − rank(A)}` — the size of the null space. This counts, e.g., the codewords of the code `Null(A)` defined by parity-check matrix `A`.

### 6.1 Worked GF(2) Count

Take the GF(2) system with `n = 3` unknowns:

```
x₀ ⊕ x₁       = 1
        x₁ ⊕ x₂ = 0
```

The coefficient matrix `A = [[1,1,0],[0,1,1]]` has `rank(A) = 2`, and the augmented `[A|b]` also has rank 2 (no contradiction), so the system is **consistent**. By Theorem 6.1 the number of solutions is `2^{n − rank} = 2^{3 − 2} = 2`. Enumerating: `x₂` is free; `x₂ = 0 ⇒ x₁ = 0, x₀ = 1` giving `(1,0,0)`; `x₂ = 1 ⇒ x₁ = 1, x₀ = 0` giving `(0,1,1)`. Exactly **2** solutions, matching `2^{1}`. Each free variable doubles the count — the combinatorial content of the formula.

### 6.2 Why the Coset Structure Forces a Power of q

The proof's key step is that the solution set is a **coset** `x₀ + Null(A)`, and a coset of a subspace has the *same cardinality* as the subspace. A `d`-dimensional subspace of `GF(q)^n` is in bijection with `GF(q)^d` (via coordinates in a basis), hence has exactly `q^d` elements. No solution count over a finite field can be anything *other* than a power of `q` (or zero) — a strong structural constraint. If your computed count is not `0` or a power of `2` (over GF(2)), you have a bug. This is one of the cheapest sanity checks available for GF(2) solvers.

---

## 7. Rank over Different Fields: Reals, Z/pZ, GF(2)

**Proposition 7.1 (Field-dependence of rank).** The rank of a fixed integer matrix can depend on the field. Specifically, `rank_{GF(p)}(A) ≤ rank_ℚ(A)`, with strict inequality possible when `p` divides every maximal nonzero minor.

**Proof.** Reduction mod `p` is a ring homomorphism `φ_p : ℤ → ℤ/pℤ`. A set of rows independent over `GF(p)` lifts to rows independent over `ℚ` (a dependence over `ℚ` clears denominators to an integer dependence, which reduces mod `p`), so `rank_{GF(p)} ≤ rank_ℚ`. Strictness example: `A = [[1,0],[0,p]]` has `rank_ℚ = 2` but `rank_{GF(p)} = 1` since the second row vanishes mod `p`. ∎

**Consequence.** Computing rank mod a *single* small prime can under-report the rational rank (an "unlucky prime" dividing a minor). A large random prime divides a fixed nonzero minor `M` with probability `≤ (log_p |M|)/(\text{#primes near } p)`, negligible — hence the senior-level "large random prime" and "two-prime agreement" strategies. The real-field rank coincides with the rational rank when entries are exact rationals; floating point introduces the numerical-rank subtlety of senior level.

**Proposition 7.2 (GF(2) rank = XOR-basis size).** For vectors `v₁, …, v_m ∈ GF(2)^n` viewed as bitmasks, the size of the XOR basis produced by greedy insertion equals `rank_{GF(2)}` of the matrix with rows `v_i`.

**Proof.** Greedy insertion reduces each incoming `v` by XOR-ing out basis vectors with matching leading bits (Gaussian elimination, one row at a time). A vector is kept iff it is independent of the current basis, so the kept set is a maximal independent subset — a basis of `Row(A)` over `GF(2)`. Its size is `dim Row(A) = rank_{GF(2)}(A)`. ∎ (This is the formal link to sibling `18-bit-manipulation`.)

### 7.1 Worked Field-Dependence Example

Consider the 0/1 matrix

```
A = [ 1  1  0 ]
    [ 0  1  1 ]
    [ 1  0  1 ]
```

*Over `ℝ` (or `ℚ`):* `det(A) = 1·(1·1 − 1·0) − 1·(0·1 − 1·1) + 0 = 1 − (−1) = 2 ≠ 0`, so `rank_ℝ(A) = 3` (full rank).

*Over `GF(2)`:* `det(A) ≡ 2 ≡ 0 (mod 2)`, so `A` is singular over GF(2). Indeed Row 3 = Row 1 ⊕ Row 2 over GF(2): `(1,1,0) ⊕ (0,1,1) = (1,0,1)`. Hence `rank_{GF(2)}(A) = 2 < 3 = rank_ℝ(A)`.

The *same* matrix has rank 3 over the reals and rank 2 over GF(2). This is Proposition 7.1 with `p = 2` dividing the determinant `2`. The lesson is uncompromising: **the field is part of the problem**, and an XOR/parity problem must be solved over GF(2), never over the reals, or the rank — and every downstream solvability/count answer — will be wrong.

### 7.2 The Rank Profile across Primes

For an integer matrix `A`, define `r_p = rank_{GF(p)}(A)`. Then `r_p ≤ r_ℚ` for every prime, with equality except for the finitely many primes dividing the gcd of the maximal nonzero minors (the "bad" primes). Concretely, if the Smith normal form of `A` is `diag(d₁ | d₂ | ⋯ | d_r, 0, …)` with `d₁ | d₂ | ⋯ | d_r`, then `r_p` equals the number of `dᵢ` **not** divisible by `p`. The Smith normal form thus encodes the *entire* rank profile across all primes at once — a complete invariant. Computing it (via integer row/column operations) is the deterministic alternative to random-prime sampling when one needs guaranteed exactness over `ℚ`.

---

## 8. Determinantal Characterization and Minors

**Definition 8.1 (Minor).** A `k × k` **minor** of `A` is the determinant of a `k × k` submatrix formed by choosing `k` rows and `k` columns.

**Theorem 8.2 (Determinantal rank).** `rank(A)` equals the **largest** `k` for which some `k × k` minor of `A` is nonzero.

**Proof.** If `rank(A) = r`, there exist `r` independent columns; restricting to them gives an `m × r` submatrix of rank `r`, which has `r` independent rows, yielding a nonzero `r × r` minor. Conversely, a nonzero `k × k` minor means those `k` rows and `k` columns are independent (a nonzero determinant ⇔ full rank of the submatrix), so `rank(A) ≥ k`. Taking the maximum such `k` gives `rank(A)`. ∎

**Corollary 8.3 (Singularity).** A square `A ∈ F^{n×n}` has `rank(A) = n` iff `det(A) ≠ 0`; `rank(A) < n` iff `det(A) = 0` (singular). This connects rank to the determinant for the square case and explains Proposition 7.1's example via the minor `p`.

**Why the determinant alone is insufficient for non-square or solvability questions.** The determinant is defined only for square matrices and only distinguishes `rank = n` from `rank < n`; it cannot report `rank = n − 3` versus `rank = n − 1`, nor say anything about an `m × n` rectangular system. Rank is the *refinement* that gives the exact dimension in every case, and Rouché-Capelli's solvability test inherently needs the rank of the rectangular augmented matrix `[A|b]` — a determinant cannot express it. This is the formal reason rank, not the determinant, is the right invariant for the solvability and counting theory of this topic.

**Remark.** The determinantal characterization is theoretically clean but computationally poor (exponentially many minors); Gaussian elimination (Section 3) computes the same rank in `O(n³)`. The minor view is, however, the right tool for *symbolic* rank (rank of a matrix with variable entries: the rank is `r` generically, dropping on the variety where all `r×r` minors vanish).

### 8.1 Worked Minor Characterization

For the matrix `A` of Section 7.1 over `ℝ`, the `3×3` minor (the whole determinant) is `2 ≠ 0`, so `rank_ℝ(A) ≥ 3`, and since `rank ≤ 3`, `rank_ℝ(A) = 3`. Over GF(2) that minor is `0`; we must look for a nonzero `2×2` minor. The top-left `2×2` block `[[1,1],[0,1]]` has determinant `1·1 − 1·0 = 1 ≠ 0` (even mod 2), so `rank_{GF(2)}(A) ≥ 2`, and since the full `3×3` minor vanishes mod 2, `rank_{GF(2)}(A) = 2`. The determinantal characterization thus recovers both field-specific ranks by asking "what is the largest nonzero minor?" — over `ℝ` it is order 3, over GF(2) order 2.

### 8.2 Symbolic Rank and Genericity

For a matrix whose entries are *polynomials* in some parameters `t₁, …, t_k`, the rank is a function of the parameters. The **generic rank** `r` is the maximum over all parameter values; the rank **drops below `r`** exactly on the algebraic variety where *all* `r × r` minors vanish simultaneously (a measure-zero set in parameter space). For example, the `2×2` matrix `[[1, t],[t, t²]]` has determinant `t² − t² = 0` for *all* `t`, so its generic rank is 1, not 2 — a structural dependence (Row 2 = `t·`Row 1) that no parameter value escapes. Distinguishing "generically full rank, drops on a thin set" from "always rank-deficient" is the symbolic-rank question, solved by computing minors as polynomials and testing identical-zero — the right framework for identifiability analysis where entries depend on unknown model parameters.

---

## 9. Complexity: O(n²m), Fast Multiply, and Lower Bounds

**Theorem 9.1 (Elimination complexity).** Gaussian elimination computes `rank(A)` for `A ∈ F^{m×n}` in `O(n² m)` field operations (`O(n³)` for a square matrix), using `O(1)` extra space beyond the matrix.

**Proof.** There are at most `min(m, n)` pivots. Processing each pivot column scans `O(m)` rows to find the pivot and then eliminates it from `O(m)` rows, each elimination touching `O(n)` columns: `O(mn)` per pivot. With `≤ min(m,n)` pivots the total is `O(min(m,n) · mn) = O(n² m)` for `m ≥ n` (and symmetric otherwise). Space is in-place. ∎

**Field-operation cost.** Over `GF(2)` each operation is a bit XOR; bitsets pack `w = 64` into one machine instruction, giving `O(n²m / w)` time. Over `ℤ/pℤ` each operation is a modular add/multiply (`O(1)` for fixed-width `p`) plus one modular inverse per pivot row. Over `ℝ` each operation is a floating-point flop.

**Worked operation count.** For a square `n × n` full-rank matrix, the elimination does `n` pivots; pivot `k` eliminates the column from the `n − 1` other rows, each touching `n − k` remaining columns. The total is `Σ_{k=1}^{n} (n−1)(n−k) ≈ (n−1)·n²/2 = Θ(n³)` field operations — the familiar `n³/2`-flop figure for elimination (`n³/3` if you only eliminate below the pivot, as in pure REF rather than RREF). The modular inverse cost is `O(n)` total (one per pivot row, `O(log p)` each), negligible against the `Θ(n³)` body. This concrete count is why the `O(n³)` headline holds and why constant-factor wins (cache blocking, GF(2) bitsets) matter so much in practice.

**Numerical rank and the SVD (over `ℝ`).** Over the reals, the robust definition of rank is spectral: if `A = U Σ Vᵀ` is the singular value decomposition with singular values `σ₁ ≥ σ₂ ≥ ⋯ ≥ 0`, then `rank(A)` (exact) is the number of *nonzero* `σ_i`, and the **numerical rank** at tolerance `τ` is `#{i : σ_i > τ}`. The singular values are the canonical "sizes" of the independent directions, invariant under the orthogonal `U, V`, so they are immune to elimination order — the reason the SVD is the gold standard for ill-conditioned matrices. The **Eckart-Young theorem** adds that truncating to the top `r` singular values gives the best rank-`r` approximation in both spectral and Frobenius norm, with error `σ_{r+1}`; thus the gap `σ_r / σ_{r+1}` quantifies *how well-defined* the rank is. A large gap → unambiguous rank `r`; a gradual decay → genuinely ambiguous, no algorithmic rescue.

**Theorem 9.2 (Rank via fast matrix multiplication).** Over a field, `rank(A)` can be computed in `O(n^ω)` time, where `ω < 2.3716` is the matrix-multiplication exponent, via block (recursive) LU / PLE decomposition.

**Proof sketch.** Rank-revealing block elimination (the PLE / LSP decomposition) reduces rank computation to a constant number of matrix multiplications and recursive calls on half-size blocks, satisfying `T(n) = O(n^ω) + 2T(n/2)`, which solves to `O(n^ω)` since `ω > 2`. This is the theoretical basis of fast finite-field linear algebra libraries (FFLAS-FFPACK). ∎

**Why rank reduces to multiplication.** Partition `A` into four blocks `[[A₁₁, A₁₂],[A₂₁, A₂₂]]`. Eliminate the top-left block recursively (finding its rank and an invertible pivot submatrix), then *update the rest with a Schur complement* `A₂₂ − A₂₁ A₁₁⁻¹ A₁₂`, which is a constant number of `(n/2)×(n/2)` matrix products — the only place the `O(n^ω)` cost enters. Recursing on the Schur complement gives the total rank. The recursion mirrors fast LU/PLE decomposition; its correctness rests on the fact that the rank of a block matrix equals (rank of the top-left full-rank part) + (rank of its Schur complement), a block analogue of rank-nullity. For practical graph/finite-field sizes (`n` up to a few thousand), the constants make plain `O(n³)` or M4RI faster; the `O(n^ω)` result matters mainly as a theoretical statement that rank is no harder than multiplication.

**Lower bound.** Reading the input forces `Ω(mn)`. Whether `ω = 2` is a major open problem; for practical sizes, cache-blocked schoolbook elimination (`O(n³)`) usually beats fast-multiply rank due to constants. Over `GF(2)`, the **Method of Four Russians** gives `O(n³ / log n)` — a genuine asymptotic win exploited by M4RI.

### 9.1 The Four Russians Speedup, Precisely

**Theorem 9.3 (M4RI).** Over `GF(2)`, rank can be computed in `O(n³ / log n)` bit operations.

**Proof sketch.** Process the matrix in horizontal stripes of `k = Θ(log n)` rows. For one stripe, precompute a **Gray-code table** of all `2^k` linear (XOR) combinations of the `k` pivot rows in `O(2^k · n)` time; with `k = log n` this is `O(n²)` per stripe. Then each of the remaining `O(m)` rows is reduced against the stripe by a single `O(n)` table lookup-and-XOR rather than `k` separate XORs. Summing over `O(n/k)` stripes gives `O((n/k) · (n² + m·n)) = O(n³ / log n)`. The `log n` saving is exactly the `k` rows handled per lookup. ∎

This is the asymptotically fastest *practical* GF(2) rank method and is what the M4RI library implements; the bitset method of senior level is its `k = 1` special case (a constant-factor `w` speedup with no table).

### 9.1b Worked M4RI Stripe Count

For a `1024 × 1024` GF(2) matrix, plain bit-at-a-time elimination is `~10⁹` bit operations; a `uint64` bitset makes it `~10⁹/64 ≈ 1.6×10⁷` word operations. M4RI with stripe height `k = ⌊log₂ 1024⌋ = 10` builds a `2¹⁰ = 1024`-entry combination table per stripe (`~10⁶` ops to build) and there are `~1024/10 ≈ 102` stripes, each reducing the remaining rows via single table lookups — yielding the `O(n³/log n)` bound, roughly another `log n ≈ 10`× over the plain bitset on top of the `64`× word speedup. In practice the constant factors and cache behavior decide which wins for a given `n`; the asymptotic ordering is plain `<` bitset `<` M4RI, and production libraries auto-select by size.

### 9.2 Iterative Methods for Sparse Finite Fields

For **sparse** matrices over a finite field, dense elimination's fill-in is fatal. **Block Wiedemann** and **block Lanczos** compute the rank/nullspace using only sparse matrix-vector products `A·v` (each `O(\text{nnz})`, the number of nonzeros). The Wiedemann approach computes the minimal polynomial of `A` from a Krylov sequence `v, Av, A²v, …` via the Berlekamp-Massey algorithm; the degree structure reveals the rank. These run in `O(\text{nnz} · n)` field operations with `O(\text{nnz})` memory — no fill-in — and are the workhorses of the linear-algebra stage of integer factorization (quadratic sieve, number field sieve), where the GF(2) matrices have millions of rows but only a handful of nonzeros per row.

---

## 10. Hardness Boundaries: Tensor and Non-Negative Rank

Matrix rank is *easy* (`O(n^ω)`); two natural generalizations are **NP-hard**, marking the boundary of the friendly theory.

**Theorem 10.1 (Tensor rank hardness).** Deciding the rank of a 3-dimensional tensor `T ∈ F^{n×n×n}` (the minimum number of rank-1 tensors summing to `T`) is **NP-hard** over `ℚ` (Håstad 1990), and the rank can even depend on the field in subtler ways than the matrix case.

**Theorem 10.2 (Non-negative rank hardness).** The **non-negative rank** of a non-negative real matrix (the minimum `r` with `A = C·B`, `C, B ≥ 0` entrywise) is **NP-hard** to compute (Vavasis 2009).

**Significance.** The `O(n³)` elimination relies on two properties that fail for these generalizations: matrices factor through a *field* with subtraction (rank factorization `A = CB` uses cancellation), and the rank-1 building blocks of a matrix form a well-behaved linear structure. Tensors lack a clean elimination (no analogue of REF), and the non-negativity constraint destroys the subtraction that elimination needs. Recognizing that a problem is *matrix* rank (easy) versus *tensor* or *non-negative* rank (hard) is the key complexity-theoretic distinction — apply elimination only to the former.

**Why matrix rank escapes the hardness.** For a matrix, the rank-1 decomposition `A = Σᵢ uᵢ vᵢᵀ` with `r` terms always achieves the minimum `r = rank(A)`, and this minimum is *computable greedily* (each elimination step peels off rank-1 structure). For tensors, the minimal number of rank-1 terms (`Σᵢ uᵢ ⊗ vᵢ ⊗ wᵢ`) has no greedy peeling — choosing the "best" rank-1 term first can *increase* the total needed (the border-rank phenomenon, where a tensor is a limit of lower-rank tensors but not itself of that rank). This non-greedy, non-closed structure is precisely what makes tensor rank NP-hard while matrix rank stays polynomial. The takeaway for practitioners: the friendly `O(n³)` rank is a *two-dimensional* gift; do not assume it survives the jump to three indices.

**Contrast table.**

| Problem | Complexity | Method |
|---------|-----------|--------|
| Matrix rank over a field | `O(n^ω)`, `O(n³)` schoolbook | Gaussian elimination |
| GF(2) matrix rank | `O(n³/\log n)` (M4RI) | Four Russians / bitsets |
| Tensor rank | NP-hard | no poly algorithm |
| Non-negative matrix rank | NP-hard | no poly algorithm |
| Symbolic (parametric) rank | poly in matrix, exp in variables | minors / Gröbner |

### 10.1 Border Rank and the Limit Phenomenon

A subtlety unique to tensors (and absent for matrices) is **border rank**: a tensor `T` can be the limit of a sequence of tensors each of rank `r`, while `T` itself has rank `r' > r`. Formally, `borderrank(T) = min{ r : T ∈ closure of {tensors of rank ≤ r} }`, and `borderrank(T) ≤ rank(T)` with strict inequality possible. The canonical example is `T = e₁⊗e₁⊗e₂ + e₁⊗e₂⊗e₁ + e₂⊗e₁⊗e₁` (rank 3, border rank 2). For **matrices** no such gap exists: the set of matrices of rank `≤ r` is already closed (it is the zero set of the `(r+1)×(r+1)` minors, an algebraic variety), so border rank equals rank. This closedness is precisely why matrix rank is "nice" — the rank function is lower-semicontinuous and achieves its minimum constructively — and its failure for tensors is at the root of why tensor rank is hard and even *field-dependent* in pathological ways. The boundary between the easy two-index world and the hard three-index world could not be drawn more sharply.

---

## 11. Applications: Codes, Spans, Independence

**Linear codes.** A linear `[n, k]` code over `GF(q)` is a `k`-dimensional subspace `C ⊆ GF(q)^n`, presented by a **generator matrix** `G ∈ GF(q)^{k×n}` with `rank(G) = k` (so `|C| = q^k` by Theorem 6.1's homogeneous remark applied to `Row(G)`), or by a **parity-check matrix** `H ∈ GF(q)^{(n−k)×n}` with `rank(H) = n − k` and `C = Null(H)`. **Syndrome decoding** solves `H x = s`, whose solution structure (a coset of `C`) is governed by Rouché-Capelli and rank-nullity. The **minimum distance** `d` equals the smallest number of columns of `H` that are linearly dependent — a rank statement about column subsets.

**Dimension of a span / independence.** Given vectors, stacking them as rows and computing the rank yields both the **dimension of their span** (= rank) and an **independence test** (independent iff rank = count). The streaming/online version is the XOR/linear basis (sibling `18`).

**Low-rank approximation and compression.** Beyond exact rank, the *near*-rank of a real matrix drives compression: an `m × n` matrix well-approximated by rank `r ≪ min(m,n)` can be stored as two factors of total size `r(m + n)` instead of `mn` (the basis of PCA, latent-factor recommender models, and the Eckart-Young truncated SVD above). Here the relevant quantity is not the exact rank but the *effective* rank — how many singular values carry most of the energy `Σ σ_i²`. This is the bridge from the discrete, field-exact rank of this topic to the continuous, approximate "rank" of numerical linear algebra and machine learning.

**Solvability and degrees of freedom.** For `A x = b`: Rouché-Capelli decides existence; rank-nullity gives `n − rank` degrees of freedom; over `GF(q)` the exact count is `q^{n−rank}`. These three together form the complete solution theory of linear systems built entirely on rank.

### 11.3 Worked Coding Example: the [7,4] Hamming Code

The binary `[7, 4]` Hamming code corrects single-bit errors. Its parity-check matrix `H` (a `3 × 7` GF(2) matrix) has as columns the binary representations of `1` through `7`:

```
H = [ 0 0 0 1 1 1 1 ]
    [ 0 1 1 0 0 1 1 ]
    [ 1 0 1 0 1 0 1 ]
```

- **Rank of `H`:** the columns include `001, 010, 100` (standard basis), so `rank_{GF(2)}(H) = 3 = n − k`, confirming `k = 7 − 3 = 4` message bits and `2^4 = 16` codewords (`= |Null(H)|`, by Theorem 6.1 with `b = 0`).
- **Minimum distance:** no column is zero (so `d ≥ 2`); all 7 columns are *distinct* (so no two are equal, `d ≥ 3`); but columns `001, 010, 011` are dependent (`011 = 001 ⊕ 010`), giving `d = 3`. A distance-3 code corrects `⌊(d−1)/2⌋ = 1` error — the defining Hamming property.
- **Syndrome decoding:** a received word `y` with one error gives syndrome `s = H y`, and `s` (as a 3-bit number) *is* the index of the flipped bit — solving `H e = s` for the weight-1 error `e`. The whole decoding procedure is rank/nullity bookkeeping over GF(2).

This single example shows rank determining dimension (`k`), codeword count (`2^k`), error-correcting power (via `d` = smallest dependent column count), and the decoding map — the entire theory of a linear code resting on finite-field rank.

### 11.4 Constraint Deduplication via the Left Null Space

Given a constraint matrix `A` (rows = constraints), the **redundant** constraints are exactly those expressible from the others: row `i` is redundant iff `Row(A \ {i}) = Row(A)`. The number of redundancies is `m − rank(A)`, and a basis of the **left null space** `Null(Aᵀ)` (dimension `m − rank`) gives explicit recipes `cᵀA = 0` exposing *which* combinations of constraints are dependent. In an LP/QP preprocessor, computing this once removes degeneracy-inducing duplicate rows; the online XOR/linear basis (senior level) does it incrementally as constraints stream in, flagging each new constraint as redundant the instant it fails to raise the rank.

### 11.5 Identifiability as a Rank Condition

In parameter estimation, a model `y = Xβ` (design matrix `X`, parameters `β`) is **identifiable** iff `X` has full column rank: then `XᵀX` is invertible and the least-squares estimate `β̂ = (XᵀX)⁻¹Xᵀy` is unique. If `rank(X) < (\#parameters)`, there is a null-space direction `v` with `Xv = 0`, so `β` and `β + cv` produce *identical* predictions for all `c` — the data cannot distinguish them. The unidentifiable parameter combinations are exactly `Null(X)`, of dimension `(\#params) − rank(X)`. A concrete instance: regressing on two perfectly collinear features (one a scalar multiple of the other) makes `X` rank-deficient by 1, and only their *sum's* coefficient is identifiable, not the two individually. Reporting the null-space basis tells the modeler precisely which parameter combinations to merge or drop — a rank/nullity diagnosis with direct statistical meaning, and the same `rank(X) = rank(XᵀX)` identity from the toolkit (Section 11) is what links the design-matrix rank to the normal-equations solvability.

**Rank inequalities (toolkit).** For `A, B` of compatible sizes: `rank(A+B) ≤ rank(A) + rank(B)` (subadditivity); `rank(AB) ≤ min(rank A, rank B)`; **Sylvester's inequality** `rank(A) + rank(B) − n ≤ rank(AB)` (for `A` an `m×n`, `B` an `n×p`); and `rank(A) = rank(AᵀA)` over `ℝ`. These let you bound ranks of composite systems without recomputing.

**Proof of `rank(AB) ≤ min(rank A, rank B)`.** Every column of `AB` is `A·(column of B)`, hence lies in `Col(A)`, so `Col(AB) ⊆ Col(A)` and `rank(AB) = dim Col(AB) ≤ dim Col(A) = rank(A)`. Symmetrically, every row of `AB` is `(row of A)·B ∈ Row(B)`, so `rank(AB) ≤ rank(B)`. Taking the minimum gives the bound. ∎ A practical consequence: multiplying by a matrix can never *increase* rank, so any pipeline `A → MA → M'MA …` of linear transforms can only preserve or lose rank — never recover lost dimensions. This is why an under-determined measurement (rank-deficient `A`) cannot be repaired by post-processing alone; the lost information is gone.

### 11.1 Worked Sylvester Inequality

Let `A` be `3×2` of rank 2 and `B` be `2×3` of rank 2 (`n = 2` is the shared inner dimension). Sylvester gives `rank(AB) ≥ rank(A) + rank(B) − n = 2 + 2 − 2 = 2`, and the upper bound `rank(AB) ≤ min(2,2) = 2`, so `rank(AB) = 2` exactly. The `3×3` product `AB` is therefore rank-deficient (rank 2 < 3) no matter what — a structural fact forced by the inner dimension `n = 2`. This is the rank-2 bottleneck phenomenon: composing through a low-dimensional intermediate caps the achievable rank, the linear-algebra basis of low-rank factorization models in machine learning (an `m×n` matrix approximated as (`m×r`)·(`r×n`) has rank `≤ r`).

### 11.2 Rank and the Four Fundamental Subspaces

For `A ∈ F^{m×n}`, rank simultaneously sizes all four fundamental subspaces:

| Subspace | Lives in | Dimension |
|----------|----------|-----------|
| Column space `Col(A)` | `F^m` | `rank(A)` |
| Row space `Row(A)` | `F^n` | `rank(A)` |
| Null space `Null(A)` | `F^n` | `n − rank(A)` |
| Left null space `Null(Aᵀ)` | `F^m` | `m − rank(A)` |

The two pairs satisfy the orthogonality / dimension relations `dim Col + dim Null(Aᵀ) = m` and `dim Row + dim Null = n`. A single number — the rank — pins down all four dimensions at once. The left null space `Null(Aᵀ)` (dimension `m − rank`) is exactly the space of **dependent-row combinations**: each of its vectors is a recipe `cᵀA = 0` showing how some rows combine to zero, i.e. the `m − rank` redundancies among the rows. This is the algebraic object behind "which constraints are redundant" in the applications above.

---

## 12. Summary

- **Rank is well-defined.** Row rank `=` column rank (Theorem 2.1), via the rank factorization `A = CB`; hence `rank(A) = rank(Aᵀ) ≤ min(m,n)`.
- **Elimination computes it.** Elementary operations preserve the row space (Lemma 3.1); the pivots of any REF are independent and span the row space (Theorem 3.2), so **#pivots = rank** — the "row-reduce and count pivots" algorithm is exactly correct over a field.
- **Rank-nullity.** `rank(A) + null(A) = n` (Theorem 4.1): the `n − rank` free columns give a basis of the null space, the degrees of freedom of `A x = 0`.
- **Rouché-Capelli.** `A x = b` is solvable iff `rank(A) = rank([A|b])` (Theorem 5.1); unique iff that common rank equals `n`; otherwise an affine solution space of dimension `n − rank`.
- **Finite-field counting.** A consistent system over `GF(q)` has exactly `q^{n−rank}` solutions (Theorem 6.1), `2^{n−rank}` over GF(2) — the cardinality of the null-space coset.
- **Field dependence.** `rank_{GF(p)} ≤ rank_ℚ`, strict for unlucky primes (Proposition 7.1); GF(2) rank equals XOR-basis size (Proposition 7.2).
- **Determinantal view.** Rank = largest order of a nonzero minor (Theorem 8.2); square singularity ⇔ `det = 0` (Corollary 8.3).
- **Complexity.** `O(n²m)` schoolbook (`O(n³)` square), `O(n^ω)` via fast multiply (Theorem 9.2), `O(n³/\log n)` over GF(2) (Four Russians). Lower bound `Ω(mn)` to read the input.
- **Hardness boundary.** Matrix rank is easy; **tensor rank** and **non-negative rank** are NP-hard (Theorems 10.1–10.2) — the limit of the elimination approach.

The arc of the proofs: rank is well-defined (Section 2), elimination computes it (Section 3), and from that single number flow rank-nullity (Section 4), solvability (Section 5), and finite-field solution counting (Section 6) — with field-dependence (Section 7), the determinantal view (Section 8), complexity (Section 9), and the NP-hard boundary (Section 10) framing where the theory applies. Every applied use in Section 11 is one of these theorems instantiated.

### Complexity Cheat Table

| Task | Field | Complexity | Notes |
|------|-------|-----------|-------|
| Rank by elimination | any field | `O(n²m)` / `O(n³)` | the standard method |
| Rank by fast multiply | any field | `O(n^ω)`, `ω<2.3716` | PLE/LSP decomposition |
| GF(2) rank (bitset) | GF(2) | `O(n³/w)` | `w` = word size (64) |
| GF(2) rank (M4RI) | GF(2) | `O(n³/\log n)` | Method of Four Russians |
| Solvability test | any field | `O(n²m)` | Rouché-Capelli via REF |
| GF(2) solution count | GF(2) | `O(n²m)` then `2^{n−rank}` | rank-nullity |
| Numerical rank (reals) | `ℝ` | `O(n³)` (SVD, bigger const) | singular values > τ |
| Sparse finite-field rank | `GF(q)` | `O(\text{nnz}·n)` | block Lanczos/Wiedemann |
| Tensor / non-negative rank | — | NP-hard | not this algorithm |

### Closing Notes

- **The two cardinality rules** (sum over independence, multiply over free choices) that prove rank-nullity and the `q^{n−rank}` count are the same rules that make Gaussian elimination's pivot count meaningful.
- **Field choice is semantic, not cosmetic** (Proposition 7.1): the *same* 0/1 matrix can have different ranks over `ℝ` and `GF(2)`, and the application dictates which is correct.
- **The easy/hard boundary** (Section 10): subtraction in a field is what makes elimination work; tensors and non-negativity remove it and the problem becomes NP-hard.
- **One number, four subspaces** (Section 11.2): rank simultaneously sizes the column space, row space, null space, and left null space — the entire "four fundamental subspaces" picture collapses to a single computed integer.
- **Uniqueness of RREF** (Section 3.2): although the row operations are not unique, the pivot-column set and the rank are canonical, so every correct implementation agrees regardless of elimination order — the bedrock that makes cross-language determinism testing (senior file) meaningful.

### Practitioner's Distilled Rules

- To compute rank: row-reduce over the correct field and count pivots — `O(n³)`, exact over `GF(2)`/`ℤ/pℤ`, tolerance-bounded over `ℝ`, SVD-robust for noisy data.
- To test solvability: compare `rank(A)` and `rank([A|b])` (Rouché-Capelli); the contradiction row is the witness.
- To count solutions over `GF(q)`: confirm consistency, then `q^{n − rank}` (using `n` = columns).
- To find degrees of freedom: `nullity = n − rank`, with an explicit basis from the free columns.
- To deduplicate constraints: redundancy count `= m − rank`, recipes from the left null space `Null(Aᵀ)`.
- Never apply elimination to tensor rank or non-negative rank — those are NP-hard.
- Pick the field to match the problem: XOR/parity ⇒ GF(2), exact integers ⇒ Z/pZ (prime!), measurements ⇒ reals (with tolerance or SVD).
- Verify with the canonical invariants: `rank(A) = rank(Aᵀ)`, `rank ≤ min(m,n)`, `rank + nullity = n`, and (GF(q)) solution counts are `0` or `q^{n−rank}`.

### Sibling-Topic Map

- `17-gaussian-elimination` — the elimination engine; rank is its pivot count, solvability its contradiction-row test.
- `06-extended-euclidean-modular-inverse` — the modular inverse used to divide over `Z/pZ`.
- `02-modular-arithmetic` — the residue arithmetic underlying `Z/pZ` rank.
- `18-bit-manipulation` — the XOR/linear basis, which is GF(2) rank computed online (Proposition 7.2).

Foundational references: Strang, *Introduction to Linear Algebra* (rank, four subspaces, rank-nullity); Hoffman & Kunze, *Linear Algebra* (rigorous row rank = column rank); Golub & Van Loan, *Matrix Computations* (numerical rank, SVD); MacWilliams & Sloane, *The Theory of Error-Correcting Codes* (rank in coding); Håstad (1990) and Vavasis (2009) for tensor / non-negative rank hardness; FFLAS-FFPACK and M4RI for fast finite-field rank. Sibling topics: `17-gaussian-elimination`, `06-extended-euclidean-modular-inverse`, `02-modular-arithmetic`, and `18-bit-manipulation` (XOR basis).
