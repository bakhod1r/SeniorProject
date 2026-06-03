# Profile DP / Broken Profile DP — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Profile-State Recurrence (Full-Row Form)
3. Correctness of the Full-Row Profile Recurrence (Proof)
4. The Broken-Profile Refinement and Its Invariant (Proof)
5. Complexity: O(n·m·2^m) and the Memory Bound
6. The Transfer-Matrix Formulation
7. Eigenvalues, Growth Rate, and Closed Forms
8. The Domino Tiling Product Formula (Kasteleyn / Temperley-Fisher)
9. Counting Correctness: Bijections and the Sum Rule
10. Generalization: Semirings, Pieces, and Constraints
11. Hardness Boundary: When Profiles Blow Up
12. Summary

---

## 1. Formal Definitions

Let `G_{n,m}` be the `n × m` grid graph: vertices are cells `(r, c)` with `0 ≤ r < n`, `0 ≤ c < m`, and edges join orthogonally adjacent cells. Throughout, `m` denotes the **narrow** dimension (we assume `m ≤ n` after rotation), `p` a prime modulus, and `I` the identity matrix of the ambient semiring.

**Definition 1.1 (Domino).** A **domino** is an edge of `G_{n,m}`, i.e. a pair of adjacent cells `{(r,c),(r,c')}` with `|c−c'| = 1` (horizontal) or `{(r,c),(r',c)}` with `|r−r'| = 1` (vertical).

**Definition 1.2 (Tiling).** A **tiling** (perfect matching) of `G_{n,m}` is a set `D` of dominoes such that every cell belongs to exactly one domino. Let `Z(n,m) = |{tilings of G_{n,m}}|` be the number of tilings.

**Definition 1.3 (Reading order).** Cells are linearly ordered by `pos(r,c) = r·m + c`, `pos ∈ {0,…,nm−1}`. "Before" / "after" refer to this order.

**Definition 1.4 (Frontier at position `pos`).** For `pos = r·m + c`, the **frontier** `F(pos)` is the set of `m` cells

```
{ (r, c), (r, c+1), …, (r, m−1) } ∪ { (r+1, 0), …, (r+1, c−1) },
```

a staircase of exactly `m` cells separating the decided region (cells with smaller `pos`, together with the cross-frontier halves) from the undecided region.

**Definition 1.5 (Profile / mask).** A **profile** at `pos` is a function `σ : F(pos) → {0,1}` recording, for each frontier cell, whether it is already covered by a domino placed among the decided cells. Encoded as an integer `mask ∈ {0,…,2^m−1}` with bit `c` (the column index of the staircase cell in its row) equal to `σ` of that cell.

**Definition 1.6 (Partial tiling consistent with `(pos, σ)`).** A **partial tiling** is a set of dominoes covering all decided cells (those before `pos` in reading order) exactly once, possibly with vertical/horizontal halves protruding onto frontier cells, such that the protrusion pattern equals `σ`. Let `N(pos, σ)` be the number of such partial tilings.

**Remark.** The whole topic rests on the claim that `N(pos, σ)` satisfies a recurrence in which the state is *only* `(pos, σ)` — the decided region's internal structure is irrelevant because dominoes are local (Definition 1.1). Section 4 proves this for the broken profile.

---

## 2. The Profile-State Recurrence (Full-Row Form)

We first state the row-indexed recurrence, then refine to one cell per step in Section 4.

**Definition 2.1 (Row occupancy).** For `0 ≤ r ≤ n`, let `g_r : {0,…,m−1} → {0,1}` (a mask `μ`) record which cells of row `r` are occupied by vertical dominoes protruding from row `r−1`. Let `G(r, μ)` be the number of ways to tile rows `0,…,r−1` completely (covering every cell of those rows) so that the protrusion into row `r` equals `μ`.

**Definition 2.2 (Row-fill relation).** Write `μ ⊳ μ'` and let `w(μ, μ')` be the number of ways to choose horizontal dominoes and protruding verticals that, together with the already-occupied cells `μ`, cover **every** cell of a single row and leave **exactly** the protrusion `μ'` into the next row. (No cell of the row may be left uncovered; the row must be completed.)

**Recurrence 2.3.**
```
G(0, 0) = 1,   G(0, μ) = 0 for μ ≠ 0
G(r+1, μ') = Σ_μ  w(μ, μ') · G(r, μ)
Z(n, m) = G(n, 0).
```

The boundary `G(n, 0)` demands that after the last row no vertical protrudes (nothing hangs off the bottom). The next section proves Recurrence 2.3 counts exactly the tilings.

### 2.1 The Row-Fill Relation `w(μ, μ')` in Detail

The weight `w(μ, μ')` is itself computed by a small dynamic program over the `m` columns of a single row. Define, for a row whose cells already occupied by incoming verticals are `μ`, a left-to-right scan that decides each free cell:

```
ROW-FILL(μ):
  enumerate over columns c = 0 .. m-1, maintaining the partial outgoing mask μ':
    if cell c is occupied (by μ, or by a horizontal placed at c-1, or a vertical just placed): continue
    else cell c is free; cover it by:
        • a vertical → set bit c of μ' (protrudes into next row)
        • a horizontal with c+1 → mark c, c+1 occupied in this row (μ' bits stay 0 for them)
  at c = m: the row is fully covered; record one unit of w(μ, μ').
```

This inner DP is exactly the broken-profile micro-steps for one row (Corollary 4.5): unrolling `ROW-FILL` over the `m` columns *is* the cell-by-cell sweep. The number of `(μ, μ')` pairs with `w(μ,μ') > 0` is bounded by `2^m` per incoming `μ`, but the careful column recursion enumerates only legal completions, giving `O(m·2^m)` total work to build the full transfer matrix `T` — far less than the naive `O(4^m)` over all pairs.

**Why `w` is well-defined (no double counting within a row).** Each free cell of the row is covered by exactly one piece in any completion, and the scan decides cells in increasing column order, so a completion is uniquely described by its sequence of decisions. Distinct decision sequences yield distinct dominoes (a vertical at `c` vs a horizontal at `c` differ), so `w(μ,μ')` counts each row-completion once. This is the single-row instance of the global bijection (Theorem 9.3).

---

## 3. Correctness of the Full-Row Profile Recurrence (Proof)

**Theorem 3.1.** `G(r, μ)` as defined by Recurrence 2.3 equals the number of partial tilings of rows `0,…,r−1` with protrusion `μ` into row `r`, and hence `Z(n,m) = G(n,0)`.

**Proof (induction on `r`).**

*Base `r = 0`.* No rows are tiled; the only consistent state is "no protrusion," so `G(0,0)=1` and `G(0,μ)=0` for `μ≠0`. This matches: there is exactly one empty partial tiling, with empty protrusion.

*Inductive step.* Assume `G(r, μ)` counts partial tilings of rows `0,…,r−1` with protrusion `μ`. Consider any partial tiling `P'` of rows `0,…,r` with protrusion `μ'` into row `r+1`. Restrict `P'` to dominoes lying entirely in rows `0,…,r−1` plus the verticals protruding into row `r`; this restriction `P` is a partial tiling of rows `0,…,r−1` with some protrusion `μ` into row `r`, and is **uniquely** determined by `P'`. The remaining dominoes of `P'` lie within row `r` (horizontals) or straddle rows `r` and `r+1` (verticals protruding as `μ'`); together with the occupied cells `μ` they cover row `r` completely and produce protrusion `μ'`. By Definition 2.2 there are exactly `w(μ, μ')` such completions, each giving a distinct `P'`. Conversely, any `P` with protrusion `μ` extended by any of the `w(μ,μ')` completions yields a valid `P'`. Thus the map `P' ↦ (P, completion)` is a **bijection**, and

```
(# partial tilings of rows 0..r with protrusion μ') = Σ_μ w(μ, μ') · (# with protrusion μ into row r)
                                                     = Σ_μ w(μ, μ') · G(r, μ),
```

which is the definition of `G(r+1, μ')`. By induction the claim holds for all `r`. Setting `r = n` and demanding no protrusion (`μ' = 0`) gives `Z(n,m) = G(n,0)`. ∎

**Corollary 3.2 (Memorylessness).** The recurrence depends on the decided region *only* through `μ` (the protrusion), because dominoes are edges (local, Definition 1.1) and a completed row's internal dominoes cannot interact with any future placement. This is the structural reason the state is bounded by `2^m`.

### 3.1 Worked Verification of the Full-Row Recurrence

Take `m = 2` and trace `G(r, ·)` for the `2 × n` board (rows of width 2). The row-fill weights `w(μ, μ')` for a width-2 row:

```
incoming μ = 00 (both cells free):
   • two verticals down → μ' = 11
   • one horizontal (covers both) → μ' = 00
   so w(00,11)=1, w(00,00)=1
incoming μ = 01 (right cell occupied from above):
   • left cell must be covered: vertical down → μ' = 10 ; horizontal needs right free → illegal
   so w(01,10)=1
incoming μ = 10 (left cell occupied):  symmetric → w(10,01)=1
incoming μ = 11 (both occupied): nothing to place → μ' = 00, w(11,00)=1
```

Collecting into `T[μ'][μ]` (column = incoming) over the *reachable* masks `{00, 11}` for the empty-start board, the reduced recurrence is `G(r+1, 00) = G(r, 00) + G(r, 11)` and `G(r+1, 11) = G(r, 00)`, which after eliminating `11` gives `G(r+1,00) = G(r,00) + G(r-1,00)` — the **Fibonacci recurrence**. With `G(0,00)=1`, `G(1,00)=1`, we get `G(n,00) = F(n+1)`, confirming Theorem 3.1 against the closed form of Section 7. This is the smallest non-trivial instance and the canonical unit test.

---

## 4. The Broken-Profile Refinement and Its Invariant (Proof)

The full-row transition `w(μ,μ')` hides an inner enumeration over the row. The **broken profile** unrolls it into `m` micro-steps, one per cell, each O(1).

**Definition 4.1 (Broken-profile state).** `dp[pos][mask] = N(pos, mask)` (Definition 1.6): the number of partial tilings consistent with reaching cell `pos` with frontier profile `mask`.

**Transition 4.2.** At `pos = r·m + c`, let `b = 1<<c` and `v = dp[pos][mask]`.

- If `mask & b ≠ 0` (cell `(r,c)` already covered): the unique move is to advance, clearing bit `c`:
  ```
  dp[pos+1][mask ⊕ b] += v.
  ```
- If `mask & b = 0` (cell `(r,c)` free): it must be covered now, by either
  - a **vertical** `(r,c)-(r+1,c)` (legal iff `r+1<n`), setting bit `c`:
    ```
    dp[pos+1][mask | b] += v;
    ```
  - a **horizontal** `(r,c)-(r,c+1)` (legal iff `c+1<m` and `mask & (1<<(c+1)) = 0`), setting bit `c+1`:
    ```
    dp[pos+1][mask | (1<<(c+1))] += v.
    ```

**Lemma 4.3 (Frontier-shift consistency).** Under Transition 4.2, the bit indexed by `c` of `mask` at position `pos = r·m+c` always equals the occupancy `σ` of the staircase cell `(r,c)`, and after the transition the reindexed `mask` correctly describes `F(pos+1)`.

**Proof.** The staircase `F(pos)` lists, at bit `c`, exactly the cell `(r,c)` (for `c < m`, the current-row portion's first cell). A vertical placed at `(r,c)` reaches `(r+1,c)`, which is the bit-`c` cell of `F(pos+1)` once the window shifts; setting bit `c` records that. Advancing past a covered cell removes `(r,c)` from the decided/frontier boundary and brings `(r+1,c)` (still free) onto the frontier at bit `c` — represented by clearing bit `c`. A horizontal at `(r,c)-(r,c+1)` leaves `(r,c)` behind and marks `(r,c+1)` (bit `c+1` of `F(pos)`, which is bit `c+1` of `F(pos+1)`) as covered. In every case the post-transition mask's bits coincide cell-for-cell with the occupancy pattern of `F(pos+1)`. ∎

**Theorem 4.4 (Broken-profile correctness).** `dp[pos][mask]` defined by `dp[0][0]=1` and Transition 4.2 equals `N(pos, mask)`, and `Z(n,m) = dp[nm][0]`.

**Proof (induction on `pos`).** *Base:* before any cell, the only partial tiling is empty with empty frontier, so `dp[0][0]=1`, `dp[0][mask]=0` otherwise — matching `N(0,·)`. *Step:* a partial tiling consistent with `(pos+1, mask')` decomposes **uniquely** according to how cell `(r,c)` was covered: if `(r,c)` was already covered before reaching it, the decision at `pos` was "advance" from the predecessor mask `mask = mask' ⊕ b` (with bit `c` set); if `(r,c)` was covered by a fresh vertical, the predecessor had bit `c` free and we set it; if by a fresh horizontal, the predecessor had bits `c` and `c+1` free and we set bit `c+1`. These cases are mutually exclusive and exhaustive (a free cell is covered exactly one way; a covered cell advances exactly one way), and by Lemma 4.3 the predecessor masks are precisely those Transition 4.2 reads. Summing the predecessor counts gives `dp[pos+1][mask']`, matching the bijective decomposition of partial tilings. Hence `dp[pos+1][mask'] = N(pos+1, mask')`. By induction, and demanding the empty frontier after the last cell, `Z(n,m) = dp[nm][0]`. ∎

**Corollary 4.5 (Equivalence of the two formulations).** `dp[(r+1)m][μ'] = G(r+1, μ')` for masks aligned to a row boundary, because the `m` micro-steps over a row compose exactly into the full-row weight `w(μ,μ')`. The broken profile is the full-row recurrence with the inner row-fill enumeration made explicit and O(1)-per-step.

### 4.1 Worked Broken-Profile Trace on `2 × 3`

We verify Theorem 4.4 on the `2 × 3` board (`n = 2`, `m = 3`). Cells in reading order, masks 3 bits, bit `c` ↔ column `c`. Start `dp[0][000] = 1`.

```
pos 0 = (0,0), bit0:  000 free → vert: dp[1][001]+=1 ; horiz(c+1=1 free): dp[1][010]+=1
pos 1 = (0,1), bit1:
  from 001 (bit1=0 free): vert→011 ; horiz(c+1=2 free)→101
  from 010 (bit1=1 filled): advance, clear → 000
pos 2 = (0,2), bit2:
  from 011 (bit2=0 free): vert→111 ; horiz c+1=3 out of range → none
  from 101 (bit2=1 filled): advance, clear → 001
  from 000 (bit2=0 free): vert→100 ; horiz out of range → none
pos 3 = (1,0), bit0 (last row: r+1=2 not < n, NO verticals):
  from 111 (bit0=1 filled): clear → 110
  from 001 (bit0=1 filled): clear → 000
  from 100 (bit0=0 free): horiz(c+1=1 free)→110 ; vertical illegal
pos 4 = (1,1), bit1:
  from 110 (bit1=1 filled): clear → 100
  from 000 (bit1=0 free): horiz(c+1=2 free)→100 ; vertical illegal
  (two paths now sit on 100)
pos 5 = (1,2), bit2:
  from 100 (bit2=1 filled): clear → 000   ← three units of count funnel here
dp[6][000] = 3   ✓
```

Three terminal units at `mask = 0`, matching `Z(2,3) = 3` and the three explicit tilings. Each unit corresponds bijectively to one decision path (Theorem 9.3). Notice the *last-row* constraint: at `pos ≥ 3` the `r+1 < n` guard kills all verticals, forcing horizontals — exactly the boundary behavior the recurrence encodes. A brute-force enumeration over the `≤ 3` decision branches per free cell reproduces the same total, the empirical anchor for the inductive proof of Theorem 4.4.

### 4.2 The Last-Decision Bijection, Made Explicit

The inductive step of Theorem 4.4 hinges on the **bijection** between partial tilings reaching `(pos+1, mask')` and pairs (predecessor partial tiling, last decision). Concretely, for the cell `(r,c)`:

```
{ partial tilings consistent with (pos+1, mask') }
   ≅  { (P, advance)   : P consistent with (pos, mask'⊕bit), bit c of (mask'⊕bit) set }
   ⊎  { (P, vertical)  : P consistent with (pos, mask'⊖bit), cell (r,c) free, r+1<n }
   ⊎  { (P, horizontal): P consistent with (pos, mask' with bit c+1 cleared), cells (r,c),(r,c+1) free }
```

a disjoint union over *how cell `(r,c)` got covered*. Disjointness: a given `P'` covers `(r,c)` in exactly one way, recoverable from `P'`, so it lands in exactly one class. Surjectivity: each (predecessor, valid decision) reassembles a unique `P'`. Taking cardinalities and applying `|A ⊎ B| = |A| + |B|` yields the additive transition of 4.2. This is the same sum-rule/bijection machinery as the walk-counting proof in sibling `11-graphs` `32-paths-fixed-length`, specialized to grid placements.

---

## 5. Complexity: O(n·m·2^m) and the Memory Bound

**Theorem 5.1 (Time).** The broken-profile DP runs in `O(n · m · 2^m)` time.

**Proof.** There are `nm` cells. At each cell the algorithm iterates over all `2^m` masks; for each nonzero mask it performs `O(1)` work (at most three target updates, Transition 4.2). Total `O(nm · 2^m · 1) = O(n·m·2^m)`. ∎

**Theorem 5.2 (Space).** Using a rolling array, the DP uses `O(2^m)` space.

**Proof.** Transition 4.2 maps `dp[pos][·]` to `dp[pos+1][·]`; only two consecutive layers are ever needed. Each layer is an array of `2^m` integers. Hence `O(2^m)` space. ∎

**Remark (reachable masks).** The bound `2^m` counts all masks, but the set of masks with `dp[pos][mask] > 0` (reachable profiles) is generally a strict subset; the zero-skip optimization iterates effectively over that subset, improving the constant but not the worst-case bound. For dominoes, reachable masks at a cell are those expressible as a partial vertical-protrusion pattern, still up to `Θ(2^m)` in the worst case.

**Remark (modular cost).** Each addition is `O(1)` for fixed-width `p`. For exact big-integer counts, an addition costs `O(D)` where `D = Θ(nm · log λ)` is the digit length (Section 7), so the exact-count time is `O(n·m·2^m · D)` — the reason problems specify a modulus.

### 5.1 Tightness and the Rotation Lemma

**Lemma 5.3 (Rotation optimality).** Among the two ways to assign the grid's dimensions to `(n, m)`, choosing `m = min(rows, cols)` strictly minimizes the bound `O(n·m·2^m)` whenever the dimensions differ, because `2^m` dominates: for `rows = a > b = cols`, `a·b·2^b` vs `b·a·2^a` differ by the factor `2^{a−b} ≫ 1`. Hence the rotation `m ← min(rows, cols)` is not a heuristic but the provably optimal assignment for this bound.

**Proof.** The two products share the factor `ab`; they differ only in `2^m`. Since `2^x` is strictly increasing, `2^{min} < 2^{max}` whenever `min < max`. ∎

**Lower bound (output-size).** Reading the answer is `O(1)`, but *producing* the DP requires touching `Ω(R)` reachable states across the sweep, where `R` is the number of reachable masks summed over cells; in the worst case `R = Θ(nm·2^m)` (e.g. dense reachability), so the `O(n·m·2^m)` bound is tight up to the zero-skip constant. The zero-skip improves the *constant* (iterating only nonzero masks) but cannot beat the worst case, where a constant fraction of masks are reachable at each cell.

**Comparison to the determinant method.** The Kasteleyn algorithm (Section 8) is `O((nm)^3)` independent of which side is small — polynomial in the *area*, not exponential in any dimension. Therefore the crossover is governed by `min(rows,cols)`: profile DP wins when `2^{min} ≪ (nm)^2` (one side small), and the determinant wins when both sides are large. This is the formal statement behind the senior-level advice "small dimension → profile DP; both large + planar → Kasteleyn."

---

## 6. The Transfer-Matrix Formulation

Recurrence 2.3 is linear with a **row-independent** coefficient matrix.

**Definition 6.1 (Transfer matrix).** Let `T ∈ ℕ^{2^m × 2^m}` with `T[μ'][μ] = w(μ, μ')` (Definition 2.2): the number of ways a row with incoming occupancy `μ` produces outgoing occupancy `μ'`.

**Proposition 6.2.** With `g_r ∈ ℕ^{2^m}` the vector `g_r[μ] = G(r, μ)`, Recurrence 2.3 reads `g_{r+1} = T g_r`, hence `g_n = T^n g_0` with `g_0 = e_0` (the indicator of `μ=0`), and

```
Z(n,m) = (T^n)[0][0] = e_0ᵀ T^n e_0.
```

**Proof.** Immediate from Recurrence 2.3: matrix-vector multiplication `(T g_r)[μ'] = Σ_μ T[μ'][μ] g_r[μ] = Σ_μ w(μ,μ') G(r,μ) = G(r+1,μ')`. Iterating `n` times and reading the `μ=0` component gives the result; the diagonal entry `(T^n)[0][0]` is `e_0ᵀ T^n e_0`. ∎

**Theorem 6.3 (Walk interpretation).** `(T^n)[0][0]` is the number of length-`n` walks from vertex `0` to vertex `0` in the directed multigraph on vertex set `{0,…,2^m−1}` with `T[i][j]` parallel edges `j → i`. This is precisely the matrix-power walk-count theorem (sibling `11-graphs` `32-paths-fixed-length`): each tiling is a length-`n` walk closing the empty-to-empty profile.

**Proof.** By the walk-counting theorem, `(T^n)[i][j]` counts length-`n` walks `j ⇝ i` in that multigraph. Specializing `i = j = 0` and invoking Proposition 6.2 identifies tilings with such closed walks. Associativity of matrix multiplication (over the semiring `(ℕ,+,×)`) makes `T^n` well-defined and computable by binary exponentiation. ∎

**Interpretation.** Each *vertex* of the transfer graph is a possible row-occupancy mask; each *edge* (with multiplicity `w(μ,μ')`) is a legal way to fill one row, transforming incoming occupancy `μ` into outgoing `μ'`. A tiling of the whole board is then literally a **closed walk** of length `n` that starts at the empty mask `0`, threads through `n` rows, and returns to `0`. This is the exact same reduction that turns "count length-`k` walks" into "raise the adjacency matrix to the `k`-th power" (sibling `11-graphs` `32-paths-fixed-length`): the profile DP *is* a walk count on the transfer graph, and binary exponentiation is the shared engine. The "skip a filled cell / place vertical / place horizontal" micro-decisions of the broken profile are exactly the edge choices that compose one such row-step.

**Why powers of `T` commute (binary-exponentiation validity).** `T^a` and `T^b` are both polynomials in the single matrix `T`, and any two polynomials in the same matrix commute, so `T^a · T^b = T^{a+b}` regardless of `T`'s non-commutativity with other matrices. This is precisely what licenses the squaring algorithm that computes `T^n` in `O(log n)` multiplies — the same justification as in the matrix-power topic, reused verbatim here.

**Corollary 6.4 (Complexity for large `n`).** `T^n` is computable in `O((2^m)^3 log n) = O(8^m log n)` by binary exponentiation, giving the tiling count in time **logarithmic** in `n`. For the `2 × n` board, `T = [[1,1],[1,0]]` (the Fibonacci matrix; reachable masks are `{0,1}`), so `Z(2,n) = F(n+1)`.

### 6.1 Generating-Function Dual

The transfer matrix has a generating-function shadow, identical in spirit to the walk-counting GF of sibling `11-graphs` `32-paths-fixed-length`.

**Proposition 6.5.** Let `W(x) = Σ_{r≥0} (T^r)[0][0] x^r` be the OGF of the per-row tiling counts. Then `W(x)` is a **rational function** whose denominator divides `det(I − xT)`:

```
Σ_{r≥0} T^r x^r = (I − xT)^{-1},   so W(x) = [(I − xT)^{-1}]_{0,0} = adj(I − xT)_{0,0} / det(I − xT).
```

**Proof.** Formally `(I − xT) Σ_r T^r x^r = Σ_r T^r x^r − Σ_r T^{r+1} x^{r+1} = T^0 = I` (telescoping), so the series is the inverse; Cramer's rule gives the rational form with denominator `det(I − xT)`. ∎

**Corollary 6.6 (Linear recurrence on row counts).** Because `W(x)` is rational with denominator of degree `≤ 2^m`, the sequence `Z(r, m) = (T^r)[0][0]` satisfies a **constant-coefficient linear recurrence of order `≤ 2^m`** in `r`. For `m = 2` the denominator is `1 − x − x²` (Fibonacci); for general fixed `m` the minimal recurrence order equals the degree of the minimal polynomial of `T` restricted to the cyclic subspace generated by `e_0`. This is why fixed-`m` tiling counts always obey a linear recurrence in the long dimension — a classical transfer-matrix fact (Flajolet-Sedgewick). The radius of convergence of `W(x)` is `1/λ_max(m)`, recovering the growth rate of Theorem 7.1 analytically: `[x^r] W(x) ∼ C · λ_max(m)^r`.

### 6.2 Worked Transfer Matrix for `m = 3`

For `m = 3` the reachable masks (vertical-protrusion patterns) and their row-fill transitions yield a transfer matrix on the 8 masks; pruning to reachable states gives the recurrence

```
Z(r, 3) satisfies  Z(r) = 4 Z(r-2) − Z(r-4),   with Z(0)=1, Z(2)=3, Z(4)=11, Z(6)=41,
```

(odd `r` give `0` because `3·r` must be even). The values `1, 3, 11, 41, 153, …` are the `3 × n` domino-tiling counts (for even `n`), and they match both the broken-profile sweep and the Kasteleyn formula of Section 8 — a three-way cross-check (sweep, transfer-matrix recurrence, closed form).

---

## 7. Eigenvalues, Growth Rate, and Closed Forms

**Setup.** If `T` is diagonalizable, `T = S Λ S^{−1}` with `Λ = diag(λ_1,…,λ_{2^m})`, then `T^n = S Λ^n S^{−1}` and

```
(T^n)[0][0] = Σ_r c_r λ_r^n,   c_r = S[0][r](S^{−1})[r][0].
```

**Theorem 7.1 (Geometric growth in `n`).** For fixed `m`, if the transfer graph (restricted to reachable masks) is strongly connected and aperiodic with Perron eigenvalue `λ_max(m) > 0`, then `Z(n,m) = Θ(λ_max(m)^n)` as `n → ∞`.

**Proof.** Perron-Frobenius applied to the non-negative matrix `T`: the dominant term `c·λ_max^n` controls the asymptotics; `c > 0` because `0` lies on a closed walk (the all-vertical or all-horizontal tilings exist for compatible parities). ∎

**Worked case `m = 2`.** `T = [[1,1],[1,0]]`, characteristic polynomial `λ^2 − λ − 1`, roots `φ = (1+√5)/2`, `ψ = (1−√5)/2`. Then `Z(2,n) = F(n+1) = (φ^{n+1} − ψ^{n+1})/√5`, growth rate `φ ≈ 1.618`. The per-column growth rate of general `n × m` tilings tends to the **dimer constant** (Section 8) as `m → ∞`.

**Exactness caveat.** Eigenvalues of integer matrices are algebraic, typically irrational; the spectral formula gives growth rate and asymptotics but **not** exact integer counts. Exact counts require integer arithmetic mod `p` (Section 5 remark). This is the same "eigenvalues for growth, modular integers for exactness" doctrine as in the matrix-power topic.

### 7.1 Worked Spectral Example (`m = 2`, Fibonacci)

`T = [[1,1],[1,0]]`, characteristic polynomial `λ² − λ − 1`, eigenvalues `φ = (1+√5)/2 ≈ 1.618`, `ψ = (1−√5)/2 ≈ −0.618`. Diagonalizing and reading `(T^n)[0][0]` (or `[0][1]`) gives Binet's formula `F(n+1) = (φ^{n+1} − ψ^{n+1})/√5`. Since `|ψ| < 1`, the `ψ` term decays and `Z(2,n) = F(n+1) ∼ φ^{n+1}/√5`, so the per-column growth rate for the `2 × n` strip is exactly the golden ratio `φ`. To compute `Z(2, 10^{18}) mod p` you **cannot** use Binet in floating point (`φ` is irrational); you must power `T` over `ℤ_p`. This single example crystallizes the "eigenvalues for growth, modular integers for exactness" doctrine.

### 7.1b Closed Forms from the Characteristic Polynomial

For fixed small `m`, once the reduced transfer matrix `T` (on reachable masks) is known, its characteristic polynomial `χ_T(λ)` yields a closed-form linear recurrence for `Z(n,m)` in `n` (Cayley-Hamilton: `T` satisfies `χ_T`, so `(T^n)[0][0]` obeys the same recurrence as `χ_T`'s coefficients dictate). For `m = 2`, `χ_T(λ) = λ² − λ − 1` gives `Z(2,n) = Z(2,n-1) + Z(2,n-2)`. For larger `m` the recurrence order is the degree of the minimal polynomial of `T` on the cyclic subspace generated by `e_0` — at most `2^m`, usually far less after reduction. This is the same Cayley-Hamilton / Kitamasa bridge as in the matrix-power topic: when only the *sequence* `Z(·,m)` is wanted (not the full matrix), one can compute the `n`-th term via polynomial exponentiation modulo `χ_T` in `O((deg χ)² log n)`, beating the `O(8^m log n)` matrix power when the reduced degree is small.

### 7.1c Full Eigendecomposition of the `m = 2` Transfer Matrix

To exhibit the spectral machinery end-to-end, diagonalize `T = [[1,1],[1,0]]` explicitly and recover `(T^n)[0][0]` from the eigenvalues.

**Eigenvalues.** `det(T − λI) = (1−λ)(−λ) − 1 = λ² − λ − 1 = 0`, giving `λ_{1,2} = (1 ± √5)/2`, i.e. `φ = 1.6180…` and `ψ = −0.6180…`. Note `φ + ψ = 1 = tr(T)` and `φ·ψ = −1 = det(T)`, the trace/determinant sanity checks.

**Eigenvectors.** For `λ`, solve `(T − λI)x = 0`: row 1 reads `(1−λ)x₁ + x₂ = 0`, so `x₂ = (λ−1)x₁`. Since `λ² = λ + 1`, we have `λ − 1 = 1/λ`, hence the eigenvector is `(λ, λ−1) = (λ, 1/λ)`, or scaled, `v_λ = (λ, 1)`. Thus

```
S = [ φ   ψ ]      S^{-1} = 1/(φ−ψ) · [  1   −ψ ]   with φ − ψ = √5.
    [ 1   1 ]                          [ −1    φ ]
```

**Powers.** `T^n = S · diag(φ^n, ψ^n) · S^{-1}`. Reading the top-left entry:

```
(T^n)[0][0] = (1/√5) · ( φ · φ^n · 1  −  ψ · ψ^n · (−1)·(−1) ... )
```

Carrying the arithmetic through cleanly, the `(0,0)` entry works out to `(φ^{n+1} − ψ^{n+1})/√5 = F(n+1)` — **Binet's formula**. Concretely, `(T^3)[0][0] = (φ⁴ − ψ⁴)/√5 = (6.854… − 0.1459…)/2.236… = 3`, matching `Z(2,3) = 3`. The decomposition makes three professional points precise:

1. **Growth.** Because `|ψ| < 1`, `ψ^{n+1} → 0`, so `Z(2,n) ∼ φ^{n+1}/√5` — the per-column growth rate is exactly the Perron eigenvalue `φ` (Theorem 7.1 specialized).
2. **Exactness fails in floating point.** `φ` and `ψ` are irrational; Binet evaluated in IEEE-754 loses the needed precision well before `n ≈ 70`. For exact `Z(2,n) mod p` you must power `T` over `ℤ_p`, never use the closed form numerically.
3. **The recurrence is the characteristic polynomial.** `χ_T(λ) = λ² − λ − 1` is literally the Fibonacci recurrence `Z(n) = Z(n-1) + Z(n-2)` read off Cayley-Hamilton (`T² = T + I`), connecting Section 7.1b's claim to a one-line computation.

This worked `2×2` case is the smallest instance where eigenvalues, eigenvectors, Binet's formula, the Perron growth rate, and the Cayley-Hamilton recurrence all coincide — the canonical pedagogical anchor before tackling the `m=3` matrix of the senior file.

### 7.2 The Per-Cell Growth Constant as `m → ∞`

Define `κ = lim_{m→∞} λ_max(m)^{1/m}` (the per-*cell* growth, since adding a row multiplies the count by `≈ λ_max(m)` and a row has `m` cells). The classical dimer result is

```
lim_{n,m→∞} Z(n,m)^{1/(nm)} = exp(G/π) ≈ 1.3385,
```

where `G = Σ_{k≥0} (−1)^k/(2k+1)² ≈ 0.91597` is **Catalan's constant**. This is the two-dimensional analogue of the Fibonacci `φ` (which is the *one*-dimensional, fixed-`m=2` rate). It bounds the digit length of the exact count by `≈ nm · log₂(1.3385) ≈ 0.42·nm` bits, directly informing how many CRT primes (Section 5) are needed to recover the exact value.

---

## 8. The Domino Tiling Product Formula (Kasteleyn / Temperley-Fisher)

The number of domino tilings of an `n × m` grid has a celebrated **closed form**, independent of the DP.

**Theorem 8.1 (Kasteleyn 1961; Temperley-Fisher 1961).**

```
            ⌈n/2⌉ ⌈m/2⌉ (        2 πj         2 πk   )
Z(n,m) =  ∏     ∏      ( 4 cos²(------) + 4 cos²(------) )^{1/...}
            j=1   k=1   (        n+1          m+1   )
```

stated cleanly as the product over `1 ≤ j ≤ n`, `1 ≤ k ≤ m`:

```
Z(n,m) = ∏_{j=1}^{n} ∏_{k=1}^{m} ( 4 cos²(πj/(n+1)) + 4 cos²(πk/(m+1)) )^{1/4},
```

a perfect square / integer when `nm` is even (and `0` when `nm` is odd).

**Derivation sketch.** Kasteleyn's method assigns signs (or `±i` weights) to the edges of the grid so that the **Pfaffian** of the resulting skew-symmetric weighted adjacency matrix equals the signed sum of perfect matchings, which for a planar graph with a Kasteleyn orientation equals the *unsigned* count. The Pfaffian squared is the determinant, and for the grid the eigenvalues of the Kasteleyn matrix are exactly `2i cos(πj/(n+1)) ± 2i cos(πk/(m+1))` by the eigenvectors of the path-graph Laplacian (a discrete Fourier / sine basis). Taking the product of eigenvalues and a fourth root yields the formula. The full proof belongs to the theory of dimer models and planar Pfaffians; we cite it as the exact closed form.

**Consistency with the DP.** Both compute `Z(n,m)`. The DP is exact in integer arithmetic mod `p`; the product formula involves transcendental cosines and is best used for asymptotics or as a real-valued cross-check at small sizes (where rounding is controllable). The growth constant `lim_{n,m→∞} Z(n,m)^{1/(nm)} = exp(G/π) ≈ 1.3385`, where `G` is Catalan's constant, is the **dimer / domino constant** — the asymptotic per-cell multiplicative growth, the two-dimensional analogue of the Fibonacci `φ` for the `2 × n` strip.

**Sanity values.** `Z(2,n) = F(n+1)`; `Z(8,8) = 12988816`; `Z(n,m)=0` for odd `nm`. These follow from both the DP and the formula and are the canonical test anchors.

### 8.1 The Kasteleyn Matrix in More Detail

A **Kasteleyn orientation** of a planar graph orients each edge so that every bounded face has an *odd* number of clockwise-oriented edges. For the `n × m` grid one such orientation makes horizontal edges all point right and assigns alternating signs to vertical edges by column parity. Form the skew-symmetric matrix `K` with `K[u][v] = ±1` (sign from the orientation) when `{u,v}` is an edge, `0` otherwise.

**Theorem 8.2 (Kasteleyn).** For a planar graph with a Kasteleyn orientation, the number of perfect matchings equals `|Pf(K)| = √{det(K)}` (the absolute value of the Pfaffian), because the signed terms of the Pfaffian all share one sign and hence add coherently rather than cancel.

**Why the eigenvalues are cosines.** `K` (or `KᵀK`) decomposes along the eigenvectors of the two **path-graph** Laplacians (one per dimension), whose eigenvalues are `2 − 2cos(πj/(n+1))` and `2 − 2cos(πk/(m+1))` with sine-basis eigenvectors `sin(πj r/(n+1))`. The product of the resulting eigenvalues, square-rooted, gives the Temperley-Fisher formula of Theorem 8.1. This is purely an eigenvalue computation on a structured matrix — no enumeration — which is why the closed form exists for the *full* (hole-free) grid and why holes (which break the structure) push you back to profile DP.

**Determinant method vs profile DP (regimes).** For a hole-free planar grid the Pfaffian gives `Z(n,m)` in `O((nm)^3)` regardless of which dimension is small — strictly better than profile DP when **both** dimensions are large. Profile DP wins when one dimension is small (its `2^m` is then tiny) and is the *only* practical tool once arbitrary holes or non-domino pieces appear (which the closed form cannot accommodate). The two methods are complementary, not competing.

---

## 9. Counting Correctness: Bijections and the Sum Rule

The proofs of Sections 3–4 are instances of two combinatorial principles applied to a **disjoint union over the last decision**:

**Principle 9.1 (Sum rule).** If a set `S` of objects partitions by a finite decision into disjoint classes `S = ⊎_d S_d`, then `|S| = Σ_d |S_d|`. The profile recurrence sums over the (mutually exclusive) ways the current cell/row was covered.

**Principle 9.2 (Bijective decomposition).** Each tiling `P'` consistent with state `(pos+1, mask')` corresponds **bijectively** to a pair (predecessor tiling `P` consistent with `(pos, mask)`, last decision). Injectivity: the last decision and the predecessor are recovered uniquely from `P'` (the cover of cell `(r,c)` is determined by `P'`). Surjectivity: every (predecessor, valid decision) pair assembles into a consistent `P'`. Hence cardinalities add, yielding the recurrence.

**Why no double counting.** A free cell is covered in exactly one way per branch (vertical or horizontal), and these branches produce **distinct** target masks or distinct dominoes, so no tiling is generated twice. A covered cell has a unique "advance" move. Reading order pins which cell is decided next, so the decision sequence of any tiling is **unique** — establishing a bijection between tilings and root-to-leaf decision paths. This is the formal guarantee that `dp[nm][0]` counts each tiling exactly once.

**Theorem 9.3 (No over/under-count).** The map {tilings of `G_{n,m}`} → {decision paths ending at `(nm, 0)`} is a bijection; therefore `dp[nm][0] = Z(n,m)` exactly (Theorem 4.4 restated as a counting identity).

**Proof.** *Injectivity:* two distinct tilings differ at some first cell (in reading order) where they place a different domino or cover it differently; their decision paths therefore diverge at that cell, so they map to distinct paths. *Surjectivity:* every path ending at `(nm, 0)` only ever covers free cells and never leaves a cell uncovered (the final empty frontier forces full coverage), so it assembles a valid tiling. Hence the map is a bijection and cardinalities are equal. ∎

**Corollary 9.4 (Why summing all masks is wrong for tilings).** Reading `Σ_{mask} dp[nm][mask]` instead of `dp[nm][0]` counts decision paths whose final frontier is non-empty — i.e. configurations with a domino protruding past the bottom-right edge, which are *not* tilings. Only `mask = 0` corresponds to a complete, edge-respecting tiling. (Contrast: for the independent-set count of Section 10, *every* final mask is a valid configuration, so there one **does** sum over all masks — the difference is whether the terminal frontier must be empty.)

### 9.0 The Parity Obstruction Formally

**Proposition 9.5.** If `nm` is odd, `Z(n,m) = 0`.

**Proof.** A domino covers exactly 2 cells, so any tiling partitions the `nm` cells into pairs; this requires `nm` even. Equivalently, 2-color the grid like a checkerboard: every domino covers one black and one white cell, so a tiling needs equal black and white counts, impossible when `nm` is odd (the two color classes differ by one). ∎

**Corollary 9.6 (Region balance).** More generally, for a board with holes, a domino tiling exists only if the number of black and white free cells are equal — a necessary condition the profile DP discovers automatically (it returns 0), but which is worth asserting up front as a fast reject. This checkerboard/balance argument is the combinatorial shadow of the bipartite structure that makes the Kasteleyn Pfaffian applicable.

### 9.1 Counting vs Decision Semantics

The bijection has a subtle but important consequence for *weighted* variants. If each placement carries a weight `w` (a colored tile, a probability), the contribution of a tiling is the **product** of its placement weights, and `dp[nm][0]` becomes a **sum of products** over decision paths — exactly the structure of a matrix product `(T^n)[0][0]` evaluated in the chosen semiring (Section 10). Thus the bijection is not merely a counting device: it is the combinatorial reason the recurrence is *linear* (a sum over a last decision, each contributing a multiplicative weight), which is what licenses the transfer-matrix and semiring generalizations.

---

## 10. Generalization: Semirings, Pieces, and Constraints

The recurrence used only that partial-tiling counts **add** over the last decision and that a decision contributes a **weight** (1 per legal placement). Abstracting gives a semiring view, identical in spirit to the matrix-power topic.

**Definition 10.1 (Weighted profile DP).** Over a semiring `(S, ⊕, ⊗, 0̄, 1̄)`, replace `+=` by `⊕` and edge contributions by `⊗`. Instances:

| Semiring | `⊕` | `⊗` | `dp[nm][0]` means |
|----------|-----|-----|--------------------|
| Counting `(ℕ,+,×)` mod `p` | `+` | `×` | number of tilings |
| Max-plus `(ℝ∪{−∞}, max, +)` | `max` | `+` | maximum-weight packing |
| Boolean `({0,1}, ∨, ∧)` | `∨` | `∧` | does a tiling exist? |
| Probability `(ℝ, +, ×)` | `+` | `×` | partition function / weighted sum |

The correctness proofs (Sections 3–4) used only associativity/distributivity, so they hold verbatim over any semiring (cf. the semiring generalization in `11-graphs` `32-paths-fixed-length`).

**Piece-set generalization.** For a piece set `Π` (dominoes, L-trominoes, larger polyominoes), the transition at a free cell enumerates each placement of a piece of `Π` whose anchor is `(r,c)` and that fits within the board and current frontier, updating the bits its cells occupy. The frontier width must be at least the maximum **vertical extent** of any piece minus one column's worth (so the mask encodes the full boundary a piece can reach); for dominoes that extent is 1, giving `m` bits, but trominoes/polyominoes may need `≥ 2` bits per column to encode partial protrusions.

**Constraint generalization.** For independent sets, the bit stores "selected?" and the transition forbids selecting when the up- or left-neighbor (both readable from the mask) is selected; for proper `q`-colorings the alphabet is `q` per column, giving `q^m` states. The skeleton — sweep, carry a fixed-width frontier, branch with O(1) local rules — is unchanged.

**Idempotency and what it buys.** The counting semiring `(ℕ,+,×)` is **not** idempotent (`a+a = 2a`), which is exactly why tiling counts *grow* geometrically (`λ_max^n`) and force a modulus. The max-plus and Boolean semirings *are* idempotent (`max(a,a)=a`, `a∨a=a`), so their profile DPs *saturate* rather than grow: a max-weight packing's value is bounded by the total weight, and a feasibility (Boolean) DP stabilizes once a tiling is known to exist. This is the same algebraic dichotomy as in the matrix-power topic: non-idempotent counting explodes; idempotent optimization/feasibility saturates. The correctness proof (Theorems 3.1, 4.4) used only associativity and distributivity, so it transfers verbatim to every semiring in the table of Definition 10.1.

**Worked semiring contrast.** On a `2 × 2` board with a single domino-tiling structure, the four semirings read the *same* set of decision paths but combine them differently: counting returns `2` (two tilings: two verticals or two horizontals), Boolean returns `true` (a tiling exists), max-plus returns the maximum total placement weight, and the probability semiring returns the weighted sum (partition function). One sweep, four answers — selected purely by `⊕` and `⊗`.

### 10.1 Independent-Set Recurrence, Formally

**Definition 10.2.** For grid independent sets, let `bit c` of the frontier mark "frontier cell in column `c` is *selected*." Define `h[pos][mask]` = number of partial selections of cells `0…pos-1` (with no two orthogonally adjacent selected) whose frontier selection pattern is `mask`.

**Transition 10.3.** At cell `(r,c)`, `bit = 1<<c`:
- **Skip** `(r,c)` (do not select): always legal; the cell leaves the frontier free, so clear bit `c`:
  ```
  h[pos+1][mask & ~bit] += h[pos][mask].
  ```
- **Select** `(r,c)`: legal iff the up-neighbor (bit `c` of `mask`) and left-neighbor (bit `c-1` of `mask`, when `c>0`) are *not* selected; set bit `c`:
  ```
  h[pos+1][mask | bit] += h[pos][mask].
  ```

**Theorem 10.4.** `h` correctly counts grid independent sets, and the answer is `Σ_{mask} h[nm][mask]` (every terminal frontier is a valid configuration — unlike tilings, no completion constraint).

**Proof.** Adjacency in the grid is local (each cell's constraint involves only its up and left predecessors in reading order, both encoded in `mask`), so the same memoryless argument as Theorem 4.4 applies; the only difference is the terminal: a partial selection of *all* cells is automatically a complete configuration, so we sum over all final masks rather than requiring `mask = 0`. ∎

This is the gentlest non-tiling profile DP and the cleanest illustration that the frontier-mask technique is about *local constraints summarized by a bounded-width boundary*, not about dominoes specifically.

---

## 11. Hardness Boundary: When Profiles Blow Up

Profile DP is polynomial **only because the frontier width is fixed at `m`**. Three regimes break it:

**11.1 Both dimensions large.** If `m = Θ(n) = Θ(√{area})`, then `2^m` is exponential in the side length; profile DP is exponential. Counting domino tilings is in `P` for *any* grid via the Kasteleyn determinant (Section 8) — an `O((nm)^3)` Pfaffian — so for large square grids the **determinant/Pfaffian** method, not profile DP, is the polynomial algorithm. Profile DP wins precisely when one dimension is small.

**11.2 Non-planar or 3D.** Kasteleyn's Pfaffian trick requires planarity. Counting perfect matchings (the dimer problem) in **3D** grids or general non-planar graphs is **#P-complete** (Valiant). No polynomial algorithm is known; profile DP with a 2D frontier becomes exponential in the cross-section, and the determinant method does not apply.

**11.3 Connectivity-constrained counts.** Counting tilings/configurations subject to a **global connectivity** constraint (e.g. Hamiltonian cycles, single-component covers) requires the frontier to encode a *partition/matching* of its cells (a connectivity profile), whose state count grows like the Bell/Catalan numbers `B_m`/`C_m` rather than `2^m`. This **plug DP** / Cut&Count machinery keeps the per-cell work bounded but with a larger (still single-exponential in `m`) state space; it is the boundary where the simple `2^m` profile no longer suffices.

**Theorem 11.1 (Summary of regimes).**
| Problem | Method | Complexity |
|---------|--------|-----------|
| Domino tilings, narrow `m` | profile DP | `O(n·m·2^m)` |
| Domino tilings, any 2D grid | Kasteleyn Pfaffian | `O((nm)^3)` |
| Domino tilings, astronomically large `n`, tiny `m` | transfer-matrix power | `O(8^m log n)` |
| Perfect matchings, 3D / non-planar | — | #P-complete |
| Connectivity-constrained counts | plug DP / Cut&Count | single-exponential in `m` |

The takeaway: planarity + a small dimension is exactly what keeps the problem easy; lose either and you either switch to the determinant method or fall into #P.

### 11.4 Why the Frontier Width Is the Pivotal Parameter

The profile DP is polynomial **only because** the frontier is a fixed-width window of `m` cells whose state is summarizable in `2^m` (or `q^m`) bits. Three structural facts make this work, and losing any one breaks it:

1. **Locality.** Dominoes/pieces touch only adjacent cells, so a fully-decided cell beyond the frontier cannot interact with a future placement (Corollary 3.2). Lose locality (long-range constraints) and the frontier must encode unbounded history.
2. **Bounded width.** The frontier has exactly `m` cells (Definition 1.4). If `m = Θ(√{area})`, the state `2^m` is exponential in the side length — the both-large regime (11.1).
3. **Memoryless transition.** The per-cell rule depends only on the mask, not on *which* tiling produced it. This is what compresses exponentially many partial tilings into `2^m` equivalence classes, exactly as the walk-counting recurrence compresses exponentially many walks into a `V`-dimensional state (sibling `11-graphs` `32-paths-fixed-length`).

When a global connectivity constraint is added (e.g. count tilings whose union of dominoes forms a single connected region, or Hamiltonian cycles), the equivalence classes must record *how frontier cells are linked*, not just whether they are filled. The state count jumps from `2^m` to the number of non-crossing partitions / matchings of `m` points — the **Catalan** number `C_{⌊m/2⌋}` (for non-crossing matchings) or **Bell**-like counts — still single-exponential in `m` but with a much larger base. This **plug DP** (each frontier cell carries a "plug" label identifying its connectivity component) keeps the per-cell work bounded, and the **Cut&Count** technique randomizes the connectivity check to shrink the state. These are the advanced frontier of the technique; the domino-tiling case is the simplest, where "filled vs free" (one bit) suffices because dominoes impose no global connectivity requirement.

### 11.5 The #P Boundary, Precisely

**Theorem 11.2 (Valiant).** Counting perfect matchings of a *general* graph is #P-complete; it is equivalent to computing the **permanent** of a 0/1 matrix. For *planar* graphs the Pfaffian (Section 8) gives a polynomial algorithm — planarity is exactly the escape hatch. In **three dimensions** the grid graph is non-planar, no Kasteleyn orientation exists in general, and counting dimer coverings becomes #P-complete; profile DP with a 2D cross-sectional frontier is exponential in that cross-section's area. Thus the easy/hard boundary is governed by *planarity* (for the closed form) and *small frontier width* (for the DP) — exactly the two levers identified in 11.4. The lesson mirrors the walks-vs-simple-paths gap of the matrix-power topic: a memoryless, bounded-width state is in `P`; an unbounded or non-planar state is in `#P`.

---

## 12. Summary

- **Profile recurrence.** The number of partial tilings depends on the decided region only through the frontier profile (Corollary 3.2), because dominoes are local; this bounds the state by `2^m` and is proved by a bijective decomposition over the last decision (Theorem 3.1).
- **Broken-profile invariant.** Advancing one cell at a time keeps the mask exactly `m` bits; Lemma 4.3 guarantees the bit at column `c` always equals the occupancy of the staircase cell `(r,c)`, and Theorem 4.4 proves `dp[nm][0] = Z(n,m)` with an O(1) per-step transition.
- **Complexity.** `O(n·m·2^m)` time (Theorem 5.1), `O(2^m)` rolling space (Theorem 5.2); exponential only in the narrow dimension, hence the mandatory `m = min(n,m)` rotation.
- **Transfer matrix.** The row map is a fixed `2^m × 2^m` matrix `T` with `Z(n,m) = (T^n)[0][0]` (Proposition 6.2); tilings are length-`n` closed walks (Theorem 6.3), giving `O(8^m log n)` for astronomically large `n` (Corollary 6.4) and the Fibonacci matrix for `2 × n`.
- **Spectrum.** `Z(n,m) = Θ(λ_max(m)^n)` (Theorem 7.1); eigenvalues give growth, never exact counts. The `m → ∞` per-cell growth constant is the dimer constant `exp(G/π) ≈ 1.3385`.
- **Closed form.** The Kasteleyn / Temperley-Fisher product formula (Theorem 8.1) gives `Z(n,m)` exactly via Pfaffians of a planar Kasteleyn orientation — the exact alternative to the DP and the source of `Z(8,8)=12988816`.
- **Counting correctness.** A clean bijection between tilings and decision paths (Theorem 9.3) guarantees no over- or under-counting.
- **Generalization & hardness.** The skeleton extends over any semiring and to richer pieces/constraints (Section 10); it stays polynomial only with a fixed narrow dimension and planarity — 3D/non-planar matching counting is #P-complete, and connectivity constraints need plug DP (Section 11).
- **Parity / balance.** A domino tiling needs `nm` even and, with holes, equal black/white free cells (Proposition 9.5, Corollary 9.6) — the bipartite shadow of Kasteleyn applicability.
- **Closed forms in `n`.** For fixed small `m`, Cayley-Hamilton turns `T` into a linear recurrence for `Z(·, m)`; combined with the GF duality (Section 6.1) this explains why fixed-`m` tiling counts are always C-finite sequences (`Z(2,n)=F(n+1)`, `Z(3,2k)=4Z(3,2k-2)−Z(3,2k-4)`, etc.).
- **Cross-checks.** `Z(2,n)=F(n+1)`, `Z(8,8)=12988816`, and the per-row growth `λ_max(m)` are reproduced by the sweep, the transfer-matrix recurrence, and the Kasteleyn formula — a three-way verification battery that pins down any implementation.

### Complexity Cheat Table

| Task | Method | Complexity |
|------|--------|-----------|
| Count domino tilings, narrow `m` | broken-profile DP | `O(n·m·2^m)` |
| Same, astronomically large `n`, tiny `m` | transfer-matrix power | `O(8^m log n)` |
| Count domino tilings, any 2D grid | Kasteleyn Pfaffian | `O((nm)^3)` |
| Max-weight grid packing | max-plus profile DP | `O(n·m·2^m)` |
| Grid independent sets / colorings | profile DP (wider alphabet) | `O(n·m·2^m)` / `O(n·m·q^m)` |
| Perfect matchings, 3D / non-planar | — | #P-complete |
| Connectivity-constrained count | plug DP / Cut&Count | single-exp in `m` |

### Eigenvalue / Growth Reference Table

| `m` (narrow dim) | per-row growth `λ_max(m)` | recurrence order in `n` | note |
|------------------|---------------------------|--------------------------|------|
| 2 | `φ = 1.618…` (golden ratio) | 2 (Fibonacci) | `Z(2,n)=F(n+1)` |
| 3 | `≈ 1.831` (real root) | 2 over even `n` | `1,3,11,41,…` |
| 4 | `≈ 2.618` | 3 over even `n` | `1,5,36,281,…`, `Z(4,4)=36` |
| `m → ∞` | `λ_max(m)^{1/m} → exp(G/π) ≈ 1.3385` | — | dimer / Catalan constant |

These growth rates double as **sanity checks**: a computed count whose ratio `Z(n+2,m)/Z(n,m)` does not approach `λ_max(m)^2` signals a transcription bug, exactly the geometric-growth sanity check of the matrix-power topic. The `Z(8,8)=12988816` value is reproduced by the `m=8` transfer-matrix recurrence, the broken-profile sweep, and the Kasteleyn formula — a triple cross-check that anchors any implementation.

### Probability Semiring Footnote

If each placement has a probability weight and we want the partition function `Z = Σ_{tilings} ∏ weights`, the same sweep over the real `(+, ×)` semiring computes it; `dp[nm][0]` is the partition function and `dp[nm][0] / (normalization)` gives the dimer-model probability of any boundary condition. This is the statistical-mechanics reading of the dimer model and the reason the dimer constant `exp(G/π)` is also the *free energy per site* of the planar dimer system — connecting the combinatorial count to physics via the very same transfer matrix.

### Closing Notes

- **Memorylessness is the engine** (Corollary 3.2, Section 11.4): the future depends on the decided region only through the fixed-width frontier, collapsing exponentially many partial tilings into `2^m` classes — the grid-DP analogue of the memoryless walk recurrence behind matrix exponentiation.
- **Generating-function duality** (Section 6.1): `Σ_r T^r x^r = (I − xT)^{-1}` makes "fixed-`m` tiling counts obey a linear recurrence in `n`" a theorem, not a coincidence, with the recurrence order equal to the degree of `T`'s relevant minimal polynomial.
- **Two exact methods, complementary regimes** (Sections 8, 11): the Kasteleyn Pfaffian (`O((nm)^3)`, planar, hole-free) and profile DP (`O(n·m·2^m)`, small dimension, arbitrary holes/pieces) cover disjoint sweet spots; the rotation lemma (5.3) pins which one a given board calls for.
- **Idempotency dichotomy** (Section 10): counting (non-idempotent) grows geometrically and needs a modulus; max-plus/Boolean (idempotent) saturate — the same algebra/behavior link as in the matrix-power topic.
- **Hardness boundary** (Section 11.5): bounded frontier width + planarity keep the problem in `P`; lose either and you fall into `#P` (3D/non-planar matching counting, equivalent to the permanent). This is the single most important fact for deciding whether profile DP even applies.
- **Statistical-mechanics reading** (Probability footnote): over the real `(+,×)` semiring the same sweep computes the dimer-model partition function, and the per-site free energy is the dimer constant `exp(G/π)` — the count and the physics share one transfer matrix.

The unifying thread across all twelve sections: a *fixed-width, memoryless* frontier reduces an exponential configuration space to a linear-algebraic object (a `2^m`-state recurrence, equivalently a transfer matrix), whose powers, spectrum, generating function, and closed form are all governed by the same `T`. Profile DP, transfer-matrix exponentiation, the Kasteleyn determinant, and the dimer free energy are four views of that one operator.

Foundational references: Kasteleyn (1961) and Temperley-Fisher (1961) for the dimer product formula; Flajolet-Sedgewick (*Analytic Combinatorics*, Ch. V) for the transfer-matrix method and rational generating functions; Valiant (1979) for #P-completeness of counting matchings (the permanent); Cygan et al. for Cut&Count and connectivity DP; the broken-profile and plug-DP write-ups on cp-algorithms.com; and sibling topic `11-graphs` `32-paths-fixed-length` for the matrix-power engine and walk-counting theorem underpinning Section 6.
