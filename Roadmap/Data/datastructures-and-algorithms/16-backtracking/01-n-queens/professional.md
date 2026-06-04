# N-Queens — Mathematical Foundations and Complexity

## Table of Contents
1. Formal Problem Statement
2. The Diagonal-Indexing Bijection (Proof)
3. Backtracking Explores Exactly the Valid Partial Placements
4. Correctness of the Backtracking Search
5. The Search Tree: Size and Pruning
6. Complexity Discussion
7. The Solution-Count Sequence (No Closed Form)
8. The Symmetry Group D4 and Fundamental Solutions
9. Burnside's Lemma and the Fundamental Count
10. Existence for All N (Constructive Theorem)
11. Completion is NP-Complete
12. Summary

---

## 1. Formal Problem Statement

Let `n ∈ ℕ`. The board is the grid `[n] × [n]` with `[n] = {0, 1, …, n-1}`. A **placement** of `n` queens, one per row, is a function `σ : [n] → [n]`, where `σ(r) = c` means the queen in row `r` occupies column `c`. (Restricting to one queen per row loses no solutions, since two queens in a row always attack; this is proven trivially below.)

**Attack relation.** Two distinct queens at `(r₁, c₁)` and `(r₂, c₂)` attack each other iff at least one holds:

- same row: `r₁ = r₂`,
- same column: `c₁ = c₂`,
- same main diagonal: `r₁ - c₁ = r₂ - c₂`,
- same anti-diagonal: `r₁ + c₁ = r₂ + c₂`.

**Definition 1.1 (N-Queens solution).** A placement `σ` is a *solution* iff no two queens attack. Since one-per-row already forbids row attacks, `σ` is a solution iff:

1. `σ` is **injective** (no two columns equal — no column attack), and
2. `r ↦ r - σ(r)` is injective (no two on a main diagonal), and
3. `r ↦ r + σ(r)` is injective (no two on an anti-diagonal).

**Lemma 1.2 (one queen per row).** Any non-attacking placement of `n` queens on `[n] × [n]` has exactly one queen per row. *Proof.* Two queens in the same row attack (same-row condition). So each row holds at most one. With `n` queens and `n` rows and at most one per row, pigeonhole forces exactly one per row. ∎

Thus the solution set is exactly `Sol(n) = { σ ∈ Sym-like maps : conditions 1–3 }`, a subset of injections `[n] → [n]` (permutations) satisfying the two diagonal constraints. Solutions are precisely the **permutations** of `[n]` whose `r - σ(r)` and `r + σ(r)` are each all-distinct.

---

**Definition 1.3 (partial placement).** For `0 ≤ k ≤ n`, a partial placement is a map `σ_k : {0,…,k-1} → [n]`. It is *consistent* (non-attacking) if conditions 1–3 of Def 1.1 hold for the placed queens. We write `V_k` for the set of consistent partial placements of depth `k` (formalized again in Section 3).

**Definition 1.4 (closed-form, formula).** A *closed-form* for `Q(n)` would be an expression built from a fixed finite set of standard operations (arithmetic, factorials, binomials, fixed-depth sums/products) evaluable in time polynomial in `log n` or at least `poly(n)` without enumerating placements. No such expression is known (Section 7); the distinction matters because asymptotic expressions (Section 7a) exist but are *not* closed forms for finite `n`.

## 2. The Diagonal-Indexing Bijection (Proof)

We claim the maps used in code — `d(r, c) = r - c + (n - 1)` and `a(r, c) = r + c` — are valid, complete indices for the two diagonal families.

**Definition 2.1.** A *main diagonal* (`↘`) is a maximal set of squares with `r - c` constant; an *anti-diagonal* (`↙`) is a maximal set with `r + c` constant.

**Proposition 2.2 (main-diagonal index is a bijection onto `{0,…,2n-2}`).** The value `r - c` over `(r, c) ∈ [n]×[n]` takes exactly the integers in `[-(n-1), n-1]`. The shift `d = r - c + (n - 1)` maps these bijectively to `{0, 1, …, 2n - 2}` (`2n - 1` values).

*Proof.* The minimum of `r - c` is `0 - (n-1) = -(n-1)` (top-right square) and the maximum is `(n-1) - 0 = n-1` (bottom-left square). Every integer between is achieved: for target `t ∈ [-(n-1), n-1]`, choose `r = max(0, t)`, `c = r - t`; then `0 ≤ r, c ≤ n-1` and `r - c = t`. Adding `n - 1` is a translation, hence a bijection onto `{0, …, 2n - 2}`. ∎

**Proposition 2.3 (anti-diagonal index is a bijection onto `{0,…,2n-2}`).** The value `r + c` takes exactly `{0, 1, …, 2n - 2}`.

*Proof.* Minimum `0 + 0 = 0`, maximum `(n-1)+(n-1) = 2n - 2`; for target `s`, pick `r = min(s, n-1)`, `c = s - r ∈ [0, n-1]`. ∎

**Corollary 2.4 (diagonal-conflict detection is exact).** Two queens share a main diagonal iff `d(r₁,c₁) = d(r₂,c₂)`, and share an anti-diagonal iff `a(r₁,c₁) = a(r₂,c₂)`. Hence boolean arrays `diag[0..2n-2]` and `anti[0..2n-2]` record *exactly* the occupied diagonals, with no collisions or omissions. *Proof.* `d` and `a` are injective on diagonals by construction (equal index ⇔ equal `r∓c` ⇔ same diagonal), and surjective onto the index range by Props 2.2–2.3. ∎

This justifies the `O(1)` conflict check: each of the four attack types is detected by equality of one integer key (row by structure, column by `c`, main by `d`, anti by `a`), and arrays/bitmasks over those keys give constant-time membership.

---

## 3. Backtracking Explores Exactly the Valid Partial Placements

**Definition 3.1 (valid partial placement).** For `0 ≤ k ≤ n`, a *valid partial placement of depth `k`* is an injective-on-columns, diagonal-distinct assignment `σ_k : {0,…,k-1} → [n]` of queens to the first `k` rows with no two attacking. `σ_0` is the empty placement.

Let `V_k` be the set of valid partial placements of depth `k`. Note `V_n = Sol(n)`.

**Proposition 3.2.** The backtracking recursion `solve(r)` (place a safe queen in row `r`, recurse to `r+1`, undo) visits a node for each element of `⋃_{k=0}^{n} V_k`, and **only** those.

*Proof.* By induction on `r`. The root corresponds to `σ_0 ∈ V_0`. Inductive step: at a node for `σ_k ∈ V_k`, the loop tries every column `c` and recurses iff `safe(k, c)` holds. By Corollary 2.4, `safe(k, c)` is true iff extending `σ_k` by `σ_k(k) := c` violates no attack with the first `k` queens — i.e. iff `σ_{k+1} ∈ V_{k+1}`. Therefore the children of the `σ_k` node are exactly `{σ_{k+1} ∈ V_{k+1} : σ_{k+1}|_{<k} = σ_k}`. Every valid extension is visited (the loop tries all columns), and no invalid one is (the `safe` guard rejects it). By induction the visited set is exactly `⋃_k V_k`. ∎

This is the precise meaning of "backtracking explores exactly the valid partial placements": it traverses the tree of partial solutions, never descending into a node that already violates a constraint, and never skipping a consistent one.

---

## 4. Correctness of the Backtracking Search

**Theorem 4.1 (soundness and completeness).** The backtracking search reports a placement at its base case iff that placement is a solution; and it reports *every* solution.

*Proof.* The base case fires exactly at depth-`n` nodes, which by Prop 3.2 are exactly `V_n = Sol(n)`. Soundness: any reported placement is in `V_n`, hence a solution (by Def 1.1 / Lemma 1.2). Completeness: every solution `σ ∈ V_n` has, by Prop 3.2, a corresponding leaf node, and since the search visits every node of `⋃_k V_k`, it visits that leaf and reports it. ∎

**Corollary 4.2 (counting is exact).** Incrementing a counter at each depth-`n` node yields `|Sol(n)|`, because the depth-`n` nodes are in bijection with `Sol(n)`.

**Termination.** The recursion depth is bounded by `n` (it increments `r` and stops at `r = n`), and each node's loop is finite (`n` columns), so the tree is finite and the search terminates.

---

## 4a. Equivalent Characterizations of a Solution

It is useful to collect the equivalent ways to state the solution condition, since different proofs and implementations lean on different ones.

Let `σ : [n] → [n]`. The following are equivalent:

1. `σ` places `n` non-attacking queens (one per row).
2. `σ` is a permutation of `[n]` with `r ↦ r - σ(r)` injective and `r ↦ r + σ(r)` injective.
3. For all `i ≠ j`: `σ(i) ≠ σ(j)` and `|σ(i) - σ(j)| ≠ |i - j|`.
4. The `n×n` permutation matrix `X` of `σ` has at most one 1 on each main- and anti-diagonal.
5. `{(r, σ(r)) : r ∈ [n]}` is an independent set of size `n` in the queens graph `Q_n`.

*Proof of (2) ⇔ (3).* Injectivity of `r - σ(r)` means no `i ≠ j` with `i - σ(i) = j - σ(j)`, i.e. `σ(i) - σ(j) = i - j`. Injectivity of `r + σ(r)` means no `σ(i) - σ(j) = -(i - j)`. Together these forbid `σ(i) - σ(j) = ±(i - j)`, i.e. `|σ(i) - σ(j)| ≠ |i - j|`, which is condition 3's diagonal clause; the permutation clause matches `σ(i) ≠ σ(j)`. ∎

Characterization (3) is the cleanest for hand proofs; (2) drives the array/bitmask `r ∓ c` keys; (4) connects to integer programming (Section 11a); (5) connects to graph theory (Section 11b). All describe the same set `Sol(n)`.

## 5. The Search Tree: Size and Pruning

Consider three nested trees of partial assignments to rows `0..k`:

- **All assignments (`T_all`):** any `c ∈ [n]` per row, no constraints. `|T_all|` has `n^k` depth-`k` nodes; total `Σ_{k=0}^n n^k = O(n^n)`.
- **Column-distinct (`T_perm`):** enforce injectivity only. Depth-`k` nodes number `n·(n-1)···(n-k+1)`; leaves at depth `n` are the `n!` permutations.
- **Valid partial placements (`T_valid` = `⋃_k V_k`):** the tree the backtracking search actually visits, which additionally enforces the diagonal constraints.

We have `T_valid ⊆ T_perm ⊆ T_all`. The pruning power is the gap `|T_valid| ≪ |T_perm| ≪ |T_all|`. The diagonal constraints cut `T_perm` down sharply: empirically the number of nodes visited grows like `c^n` for a base `c` substantially below `n`, but **no exact formula for `|T_valid|` is known**, mirroring the lack of a formula for the leaf count.

**Lemma 5.1 (an upper bound).** `|Sol(n)| ≤ n!` since solutions are a subset of permutations. This is extremely loose: for `n = 8`, `n! = 40320` while `|Sol(8)| = 92`.

The diagonal constraints are what make the leaf set tiny relative to `n!`: each forbids many permutations (any permutation with a repeated `r - σ(r)` or `r + σ(r)` is excluded).

---

## 5a. Formal Statement of the Conflict Invariant

We isolate the loop invariant that makes the recursion correct, because production proofs (and bug hunts) hinge on it.

**Invariant 5a.1.** At the moment `solve(r)` is entered, the occupancy structures satisfy, for every column `c`, every main-diagonal value `t`, and every anti-diagonal value `s`:

```
cols[c] = true   ⇔   ∃ r' < r with σ(r') = c
diag[t + n - 1] = true  ⇔  ∃ r' < r with r' - σ(r') = t
anti[s] = true   ⇔   ∃ r' < r with r' + σ(r') = s
```

*Proof.* By induction on `r`. Base `r = 0`: all structures are empty and there are no `r' < 0`, so all three biconditionals hold vacuously. Step: assume the invariant on entry to `solve(r)`. Inside, before recursing on a safe column `c`, we set exactly `cols[c]`, `diag[r-c+n-1]`, `anti[r+c]` to `true`, which records precisely the new queen at `(r, σ(r)=c)`; thus the invariant holds on entry to `solve(r+1)` (now ranging over `r' < r+1`). On return we unset exactly those three, restoring the invariant for the next iteration of the loop at level `r`. ∎

**Corollary 5a.2 (the `safe` test is exactly the no-attack test).** Given Invariant 5a.1, `safe(r, c) = ¬cols[c] ∧ ¬diag[r-c+n-1] ∧ ¬anti[r+c]` is `true` iff placing a queen at `(r, c)` attacks none of the queens already placed in rows `< r`. This is the formal version of Corollary 2.4 with the bookkeeping made explicit; it is what licenses the claim in Prop 3.2 that children are exactly the valid extensions.

The practical upshot: any bug that makes counts wrong is, formally, a violation of Invariant 5a.1 — a missing undo (leaves stale `true`s), a wrong index (`diag` vs `anti`), or a missing shift. CI tests against A000170 detect invariant violations indirectly; an explicit invariant assertion (in debug builds, recompute the sets from `σ` and compare) detects them directly.

## 5b. The Permutation Tree vs the Valid Tree (Quantified)

We make the nesting `T_valid ⊆ T_perm ⊆ T_all` quantitative at the leaf level.

- `T_all` leaves: `n^n`.
- `T_perm` leaves: `n!`.
- `T_valid` leaves: `Q(n)`.

By Stirling, `n! ≈ √(2πn)(n/e)^n`, so the ratio `n!/n^n ≈ √(2πn) e^{-n}` — the column constraint already removes an `e^{-n}` factor. By the Simkin rate (Section 7a), `Q(n) ≈ (n e^{-α})^n` with `α ≈ 1.94`, so

```
Q(n) / n!  ≈  (n e^{-α})^n / (√(2πn)(n/e)^n)  =  e^{-(α-1)n} / √(2πn)  ≈  e^{-0.94 n} / √(2πn).
```

So the diagonal constraints remove a further `e^{-0.94 n}` fraction of the permutations. Both reductions are exponential, yet `Q(n)` itself remains exponentially large. This is the precise sense in which "pruning is powerful but the problem is still hard": each constraint family kills an exponential fraction, but exponentially many solutions survive. The backtracking search visits a tree whose size tracks `T_valid` (up to the per-node factor), so it inherits this exponential-but-pruned size.

## 6. Complexity Discussion

- **Per-node work:** the boolean version does `O(n)` (loop over columns, each `O(1)` check). The bitmask version does `O(1)` to compute `available` and then iterates only over free columns, so the *amortized* work per child edge is `O(1)`.
- **Total time:** proportional to the number of tree edges/nodes visited, `Θ(|T_valid|)` up to the per-node factor. Since `|T_valid|` is exponential (bounded above by `O(n·n!)` for the whole `T_perm` superset, and below by `|Sol(n)|`), the search is exponential. There is no sub-exponential algorithm known for counting.
- **Space:** `O(n)` — the recursion stack depth is `n`, and the three occupancy structures are `O(n)`. Counting needs no board storage.
- **Decision vs counting:** *deciding* existence is trivial (`O(n)` constructive, Section 10). *Counting* is the hard part and is in `#P` style territory (no poly algorithm known). *Completion* decision is NP-complete (Section 11).

The "log-free" exponential here is fundamentally different from, say, matrix-power problems: there is no algebraic shortcut; the count is an irregular combinatorial quantity.

---

## 6b. Termination, Depth, and Stack Bounds (Formal)

**Proposition 6b.1.** The backtracking recursion terminates with stack depth at most `n + 1`.

*Proof.* Define the potential `Φ(node) = r` (the row index argument). Each recursive call increments `r` by 1 and the base case fires at `r = n`, so the call chain `solve(0) → solve(1) → … → solve(n)` has length `n + 1`; no call descends past `r = n`. Each level's `for` loop is finite (`n` iterations), so the entire tree is finite and every path terminates. The maximum number of simultaneously active frames is the longest root-to-node path, `n + 1`. ∎

**Corollary 6b.2 (space).** The recursion uses `O(n)` stack space plus `O(n)` for the occupancy structures (arrays of size `n` and `2n-1`), independent of the number of solutions. Counting therefore runs in `O(n)` space even when `Q(n)` is astronomically large. Emitting all solutions adds only output cost, not working-set growth, if solutions are streamed.

This bounds the practical concern of stack overflow: for any `n` you would realistically count (≤ ~20), the depth is trivial. Depth is *never* the limiting resource for N-Queens; time (number of nodes) is.

## 6a. Correctness of the Bitmask Variant

The bitmask recursion deserves its own correctness statement, since it differs operationally (masks by value, diagonal shifts) from the array version.

Let the recursion carry, at row `r`, three `n`-bit masks `(C, D, A)` where bit `c` of `C` means column `c` is used, bit `c` of `D` means a `↘` diagonal hits column `c` *in row `r`*, and bit `c` of `A` likewise for `↙`.

**Lemma 6a.1 (diagonal-shift correctness).** If `(C, D, A)` correctly describe attacks projected onto row `r`, then after placing a queen at column bit `p` and descending to row `r+1`, the masks `C' = C | p`, `D' = ((D | p) << 1) & full`, `A' = (A | p) >> 1` correctly describe attacks projected onto row `r+1`.

*Proof.* A `↘` diagonal occupied at column `c` in row `r` (so `r - c = const`) is occupied at column `c + 1` in row `r+1` (since `(r+1) - (c+1) = r - c`). Left-shifting the bit at position `c` to position `c+1` realizes this; the new queen's `↘` contribution (bit `p`) is included before the shift via `D | p`; `& full` discards a bit shifted past column `n-1` (that diagonal exits the board below). Symmetrically, a `↙` diagonal at column `c` in row `r` is at column `c - 1` in row `r+1` (`(r+1)+(c-1) = r+c`), realized by the right shift; the bit shifted past column 0 is dropped automatically. Columns never move, so `C' = C | p`. ∎

**Theorem 6a.2.** The bitmask recursion counts exactly `Q(n)`: it reaches the base case (`C = full`) once per solution and never for a non-solution.

*Proof.* By Lemma 6a.1 the masks are an invariant-correct projection of the array sets onto the current row, so `available = ~(C|D|A) & full` has bit `c` set iff column `c` is safe in row `r` by Corollary 5a.2. The `while` loop iterates exactly the safe columns (lowbit enumeration is a bijection onto the set bits), matching the array version's loop body restricted to safe columns. By Theorem 4.1 / Corollary 4.2 the array version counts `Q(n)`; the bitmask version visits the same valid-partial-placement tree, hence the same count. `C = full` (all columns used) at depth `n` is equivalent to `r = n` since one queen per row fills one new column each level. ∎

## 7. The Solution-Count Sequence (No Closed Form)

Let `Q(n) = |Sol(n)|`. The sequence (OEIS **A000170**) begins:

```
n:    1  2  3  4   5  6   7   8    9   10    11    12     13      14
Q(n): 1  0  0  2  10  4  40  92  352  724  2680  14200  73712  365596
```

**Facts:**
- `Q(2) = Q(3) = 0` (no solutions); `Q(n) > 0` for `n = 1` and all `n ≥ 4` (Section 10).
- The sequence is **not monotone** in a simple way (`Q(6) = 4 < Q(5) = 10`).
- **No closed-form formula** and **no known polynomial-time formula** exist for `Q(n)`. The best known methods are pruned exhaustive search (with bitmask/symmetry constants and massive parallelism); record values (`n = 27`) were obtained by distributed computation.
- Asymptotically, results (Simkin, 2021) show `Q(n) = ((1 + o(1)) n e^{-α})^n` for a constant `α ≈ 1.94`, giving the growth *rate* — but this is asymptotic, not an exact formula for finite `n`.

The fundamental-solution count `q(n)` (one per D4 orbit) is OEIS **A002562**:

```
n:    1  2  3  4  5  6  7   8   9   10   11    12
q(n): 1  0  0  1  2  1  6  12  46   92  341  1787
```

---

## 7a. Asymptotic Growth: The Simkin Result

While `Q(n)` has no closed form, its growth rate is now known precisely.

**Theorem 7a.1 (Simkin, 2021).** As `n → ∞`,

```
Q(n) = ( (1 + o(1)) · n · e^{-α} )^n,   where α = 1.942 ± 0.001 (a specific constant).
```

Equivalently `ln Q(n) = n ln n - α n + o(n)`. Earlier work (Luria) established the matching upper bound `Q(n) ≤ ((1+o(1)) n e^{-α})^n`; Simkin proved the lower bound, settling the leading-order asymptotics.

**Interpretation.** The dominant `n ln n` term is the "permutation" contribution (`ln n! ≈ n ln n - n`); the diagonal constraints subtract an extra `(α - 1) n ≈ 0.94 n` in the exponent, reflecting how much the two diagonal families thin out the permutations. This quantifies the pruning: of the `n!` permutations, only an `e^{-(α-1)n}` fraction (exponentially small) survive both diagonal constraints, yet that fraction is still exponentially large in absolute terms — which is exactly why the problem is both heavily pruned and still infeasible to count for large `n`.

**Why this is not a formula.** The `(1 + o(1))` and the `o(n)` hide lower-order terms that are not known in closed form; the result gives the *rate*, not the *value*. For any specific finite `n`, you still must search. This is the rigorous content of "no closed form, only asymptotics."

## 7b. The Counting Records and Their Method

The largest exactly-counted values were obtained by massive distributed/hardware-accelerated search:

```
n     Q(n)                         method / year (approx.)
20    39,029,188,884               distributed CPU
23    24,233,937,684,440           distributed CPU
26    22,317,699,616,364,044       cluster
27    234,907,967,154,122,528      FPGA + cluster (2016)
```

The technique is uniformly: enumerate independent prefixes (first few rows), assign each prefix-subtree to a worker (CPU core, GPU lane, or FPGA pipeline), apply the bitmask + symmetry + popcount kernel, and sum 64-bit partial counts. `n = 27`'s value (~2.35×10¹⁷) overflows 32 bits but fits comfortably in 64. No algorithmic breakthrough is involved — only constant factors and parallel scale — which is itself evidence that no sub-exponential method is known.

## 8. The Symmetry Group D4 and Fundamental Solutions

The board admits the **dihedral group** `D4` of order 8: the identity `e`, rotations `r₉₀, r₁₈₀, r₂₇₀`, and four reflections (horizontal `h`, vertical `v`, and the two diagonal flips `d, d'`). Each `g ∈ D4` is a bijection of the board to itself that maps queen placements to queen placements.

**Proposition 8.1.** `D4` acts on `Sol(n)`: if `σ` is a solution and `g ∈ D4`, then `g·σ` is a solution.

*Proof sketch.* Each `g` is an isometry of the board's attack structure. Reflections and 90°-rotations map rows↔columns and main↔anti diagonals (or among themselves), permuting the four attack lines among themselves. Since `σ` has no two queens sharing any attack line, neither does `g·σ`: an attack in `g·σ` would pull back through `g⁻¹` to an attack in `σ`. ∎

The **orbits** of this action partition `Sol(n)`. A **fundamental** (unique) solution is a chosen representative of each orbit. Orbit sizes divide `|D4| = 8` by the orbit-stabilizer theorem:

- Generic solutions have trivial stabilizer ⇒ orbit size **8**.
- Solutions fixed by `r₁₈₀` (or another nontrivial `g`) have orbit size `< 8` (4, 2, or 1).

So `Q(n)` is the sum of orbit sizes and is **not** simply `8·q(n)` — that overcounts the symmetric solutions.

---

## 8a. The D4 Action in Coordinates

To compute fixed-point sets one needs explicit formulas for how each `g ∈ D4` transforms a placement `σ` (as a set of squares `{(r, σ(r))}`), on an `n×n` board with indices `0..n-1`. Writing `m = n - 1`:

```
g            (r, c)  ↦
identity e    (r, c)
rot 90  r₉₀   (c, m - r)
rot 180 r₁₈₀  (m - r, m - c)
rot 270 r₂₇₀  (m - c, r)
refl horiz h  (m - r, c)          (flip top↔bottom)
refl vert v   (r, m - c)          (flip left↔right)
refl diag d   (c, r)              (transpose)
refl anti d'  (m - c, m - r)      (anti-transpose)
```

A placement `σ` is in `Fix(g)` iff applying `g` to its square set yields the same set. For example, `g = r₁₈₀`: `σ ∈ Fix(r₁₈₀)` iff for every `r`, the square `(m - r, m - σ(r))` is also a queen, i.e. `σ(m - r) = m - σ(r)` for all `r`. This is a clean functional equation one can enumerate/count.

**Proposition 8a.1.** `Fix(v)` (vertical reflection) consists of solutions with `σ(r) = m - σ(r)` … no: `v` maps `(r, c) ↦ (r, m - c)`, so `σ ∈ Fix(v)` iff `σ(r) = m - σ(r)` for all `r`, forcing `2σ(r) = m`, possible only if `m` is even and `σ(r) = m/2` for all `r` — but then all queens share column `m/2`, a column attack. Hence `Fix(v) = ∅` for `n ≥ 2`. The same argument (with rows) gives `Fix(h) = ∅`. ∎

This is the rigorous version of the "axis reflections fix nothing" claim used in the Burnside computation.

## 8b. Closure of Sol(n) Under D4: Detailed Proof

We give the full argument that `g·σ ∈ Sol(n)` for `g ∈ D4`, completing Proposition 8.1.

**Claim.** Each `g ∈ D4` permutes the four attack relations {row, column, `↘`, `↙`} among themselves.

*Proof by cases on generators.* It suffices to check the generators `r₉₀` (90° rotation) and `v` (vertical reflection), since they generate D4.

- **`r₉₀`: `(r, c) ↦ (c, m - r)`.** Two squares in the same *row* (`r₁ = r₂`) map to two squares with equal *second* coordinate's complement structure — specifically equal new-column `m - r`, so a row becomes a *column*. A column (`c₁ = c₂`) maps to equal new-row `c`, so a column becomes a *row*. A `↘` diagonal (`r - c` const) maps to new coordinates `(c, m-r)` with new `r' - c' = c - (m - r) = (r + c) - m`, constant iff `r + c` was constant — so `↘` becomes `↙`. Symmetrically `↙` becomes `↘`. Thus `r₉₀` induces the permutation (row↔column)(↘↔↙) of attack types.
- **`v`: `(r, c) ↦ (r, m - c)`.** Rows stay rows (`r` unchanged). Columns: `c₁ = c₂ ⇔ m - c₁ = m - c₂`, columns stay columns. `↘` (`r - c` const) maps to new `r - (m - c) = (r + c) - m`, constant iff `r + c` const — so `↘` ↔ `↙`. Thus `v` induces (↘↔↙).

Since every `g ∈ D4` is a product of these generators, every `g` permutes the four attack types. ∎

**Corollary 8b.1.** If `σ` has no two queens sharing any attack line, then `g·σ` has none either: a shared line in `g·σ` of some type `T` would, pulling back by `g⁻¹` (which permutes types), give a shared line of type `g⁻¹(T)` in `σ` — contradiction. Hence `g·σ ∈ Sol(n)`, proving D4 acts on `Sol(n)`. ∎

This justifies treating `Sol(n)` as a D4-set, the prerequisite for the orbit-counting (Burnside) argument that follows.

## 9. Burnside's Lemma and the Fundamental Count

**Theorem 9.1 (Burnside / Cauchy–Frobenius).** The number of orbits (fundamental solutions) is

```
q(n) = (1 / |D4|) · Σ_{g ∈ D4} |Fix(g)|
     = (1/8) ( |Fix(e)| + |Fix(r₉₀)| + |Fix(r₁₈₀)| + |Fix(r₂₇₀)|
               + |Fix(h)| + |Fix(v)| + |Fix(d)| + |Fix(d')| )
```

where `Fix(g) = { σ ∈ Sol(n) : g·σ = σ }`.

- `|Fix(e)| = Q(n)` (the identity fixes everything).
- `|Fix(h)| = |Fix(v)| = 0` for `n ≥ 2`: a solution symmetric under a row/column reflection would require two queens mirrored across the center to be non-attacking, but they share a row or column. (More precisely, vertical reflection maps the row-`r` queen to row-`(n-1-r)`; the constraints force contradictions, giving 0 fixed points for these reflections in the standard parameterization.)
- The remaining terms count solutions with the corresponding rotational/diagonal symmetry; these are small.

**Worked check (`n = 8`).** `Q(8) = 92`. Burnside gives `q(8) = 12`. Indeed `12 = (1/8)(92 + Σ symmetric terms)`, so the symmetric fixed-point terms sum to `96 - 92 = 4`; these are the few `n=8` solutions with nontrivial symmetry. The 92 solutions split into 11 orbits of size 8 and 1 orbit of size 4 (a 180°-symmetric solution): `11·8 + 1·4 = 92`, and `11 + 1 = 12` fundamentals. ✓

This is why dividing the total by 8 is wrong (`92/8 = 11.5`): the size-4 orbit breaks the naive division, and Burnside is the correct accounting.

---

## 10. Existence for All N (Constructive Theorem)

**Theorem 10.1.** `Sol(n) ≠ ∅` for `n = 1` and all `n ≥ 4` (and `Sol(2) = Sol(3) = ∅`).

*Proof (constructive).* For `n = 2, 3` exhaustive check gives no solution. For `n ≥ 4`, the Hoffman–Loessi–Moore construction exhibits an explicit `σ` depending on `n mod 6`; one verifies in `O(n)` that the resulting columns and both diagonal-key sets are all-distinct, hence `σ ∈ Sol(n)`. The case analysis (residues `0,1,2,3,4,5 mod 6`) produces, for each, an interleaving of even and odd column values (with small fixups for residues 2 and 3) that provably avoids all diagonal collisions. ∎

This proves the **decision** problem is trivial: existence holds except for `n ∈ {2,3}`, and a witness is constructible in linear time without search. The difficulty of N-Queens is entirely in *counting*, not deciding.

---

## 10a. A Fully Worked Existence Construction (n ≡ 0, 4 mod 6)

To make Theorem 10.1 tangible, here is a complete, verifiable construction for the common case `n` even with `n mod 6 ∈ {0, 4}` (1-indexed columns, rows `1..n`):

```
Row i (for i = 1 .. n/2):       column 2i
Row i (for i = n/2+1 .. n):     column 2(i - n/2) - 1
```

That is, the top half gets the even columns `2, 4, …, n` in order, and the bottom half gets the odd columns `1, 3, …, n-1` in order.

**Verification (sketch).** Columns are all distinct: the top half uses evens, the bottom half uses odds, and within each half the values are strictly increasing. Main diagonals (`r - c`): in the top half `r - c = i - 2i = -i`, all distinct; in the bottom half `r - c = (n/2 + j) - (2j - 1) = n/2 - j + 1`, all distinct; and one checks the two ranges do not overlap for `n mod 6 ∈ {0,4}`. Anti-diagonals (`r + c`): top half `i + 2i = 3i`, distinct; bottom half `(n/2+j) + (2j-1)`, distinct; the residue condition `mod 6` is exactly what prevents a top `3i` from equaling a bottom value. The residues `2` and `3` mod 6 fail this clean split and need the small fix-ups mentioned in Theorem 10.1, which is why the general construction case-splits on `n mod 6`. ∎

This concretely demonstrates that *deciding existence and exhibiting a witness is `O(n)`* — the entire difficulty of N-Queens lives in counting and in the completion variant, not in existence.

## 10b. Why the Decision/Counting Gap Is Typical

N-Queens exemplifies a recurring phenomenon: the **decision** ("does a solution exist?") can be trivial while the **counting** ("how many?") is intractable. Other examples: perfect matchings in bipartite graphs (existence by Hall's theorem / augmenting paths in poly time; counting is the permanent, #P-complete), and 2-colorings of a graph (decision = bipartite test, poly; counting proper 2-colorings is easy here but counting `k`-colorings is #P-hard for `k ≥ 3`). The structural reason is that a single witness can be found greedily/constructively, but the *number* of witnesses encodes a sum over an exponential set with no telescoping. N-Queens' lack of overlapping subproblems (Section 11c) blocks the dynamic-programming shortcut that rescues some counting problems, leaving exhaustive search as the only general method.

## 10c. Bounds on the Number of Solutions

Beyond the asymptotic rate, several concrete bounds are provable.

**Proposition 10c.1 (trivial upper bound).** `Q(n) ≤ n!`. *Proof.* Solutions inject into permutations (each solution is a permutation `σ` by Lemma 1.2 + injectivity); the diagonal constraints only remove permutations. ∎

**Proposition 10c.2 (a better upper bound via first-row symmetry).** `Q(n) ≤ n · M(n)`, where `M(n)` is the maximum over row-0 columns of the number of completions with that fixed first queen. By the mirror symmetry, columns `c` and `n-1-c` give equal completion counts, so `Q(n) = Σ_{c} (completions with row-0 = c)` is a symmetric sum, which lets the left-half computation recover the total exactly (Section on symmetry in `middle.md`).

**Proposition 10c.3 (positivity / existence as a lower bound).** `Q(n) ≥ 1` for `n = 1` and `n ≥ 4` (Thm 10.1, constructive). For `n` coprime to 6, the toroidal construction (Section 11g) gives at least the `φ`-many linear solutions `σ(r) = (ar + b) mod n`, a super-constant lower bound, though far below the true exponential count.

These bounds sandwich `Q(n)` between `1` (existence) and `n!` (permutations), with the true value sitting at the Simkin rate `≈ (n e^{-1.94})^n` — exponentially large yet an exponentially small *fraction* of `n!`. The gap between the trivial bounds and the true value is precisely the content that requires search to resolve for any specific `n`.

## 11. Completion is NP-Complete

The blank-board problem is easy, but the **N-Queens Completion** problem is not.

**Definition 11.1 (Completion).** *Input:* `n` and a set `P` of pairwise non-attacking pre-placed queens. *Question:* does there exist a full solution `σ ∈ Sol(n)` extending `P`?

**Theorem 11.2 (Gent, Jefferson, Nightingale, 2017).** N-Queens Completion is **NP-complete**. The associated counting version is **#P-complete**.

*Consequence.* Adding even partial constraints jumps the complexity from "trivially solvable" to NP-complete. Many real applications (constraint scheduling, conflict-free resource assignment modeled on the queens graph) are completion instances, which is why they are genuinely hard and why production code must budget/timeout the search (Section 9 of [`senior.md`](./senior.md)).

This dichotomy — easy to find *a* solution from scratch, hard to complete a partial one — is a clean illustration that problem hardness is sensitive to the input form, not just the underlying constraints.

---

## 11a. Permutation-Matrix Formulation and the Constraint Algebra

It is illuminating to recast the problem in linear-algebraic terms, which makes the "permutation with extra constraints" view precise and connects it to integer programming.

**Permutation matrix view.** A one-queen-per-row placement is exactly an `n×n` 0/1 matrix `X` with `X[r][c] = 1` iff a queen sits at `(r,c)`. The row constraint (one per row) is `Σ_c X[r][c] = 1` for all `r`. Adding the column constraint `Σ_r X[r][c] = 1` for all `c` makes `X` a **permutation matrix** — precisely the algebraic statement of Lemma 1.2 + injectivity. The diagonal constraints become:

```
Σ_{(r,c): r-c = t} X[r][c] ≤ 1   for each main-diagonal value t ∈ [-(n-1), n-1]
Σ_{(r,c): r+c = s} X[r][c] ≤ 1   for each anti-diagonal value s ∈ [0, 2n-2]
```

So N-Queens is the feasibility problem: *find a permutation matrix with at most one 1 on each of the `2(2n-1)` diagonal lines.* This is a 0/1 integer program; the LP relaxation is not integral in general, which is another way to see why the problem resists a simple polynomial formula.

**Proposition 11a.1.** The number of `↘` diagonal constraints plus `↙` diagonal constraints is `2(2n-1) = 4n - 2`, but only `2n - 2` of each family can ever be "tight at 1" simultaneously by a feasible solution beyond the trivial bound, because the corner diagonals (`t = ±(n-1)`, `s = 0` and `s = 2n-2`) each contain a single square. *Proof.* The diagonal `t = n-1` is the single square `(n-1, 0)`; `t = -(n-1)` is `(0, n-1)`; `s = 0` is `(0,0)`; `s = 2n-2` is `(n-1,n-1)`. Each holds at most one queen trivially, so those four constraints are redundant with the cell variables. ∎

**Why two diagonal families, not more.** A queen's four attack directions are row, column, `↘`, `↙`. Rows are handled by the one-per-row encoding, columns by the permutation constraint, and the two diagonal directions by the `r-c` / `r+c` keys. There is no fifth direction; hence exactly two diagonal index families suffice — formalizing the informal claim in Section 2.

---

## 11b. Graph-Theoretic Reformulation

N-Queens has a clean graph model that situates it among standard combinatorial problems.

**Definition 11b.1 (queens graph `Q_n`).** Let the vertices be the `n²` board squares; join two squares by an edge iff a queen on one attacks the other (same row, column, or diagonal). Then `Q_n` is the **queens graph**.

**Proposition 11b.2.** N-Queens solutions are exactly the **independent sets of size `n`** in `Q_n`.

*Proof.* An independent set is a vertex set with no two adjacent — i.e., no two mutually attacking queens. A solution places `n` non-attacking queens, which is an independent set of size `n`. Conversely, any size-`n` independent set is `n` pairwise non-attacking queens; by Lemma 1.2 it has one per row, hence is a solution. ∎

**Corollary 11b.3.** The independence number `α(Q_n) = n` for `n = 1` and `n ≥ 4` (existence, Thm 10.1), and `α(Q_2) = α(Q_3)` is `< n` for those (no size-`n` independent set). The N-Queens count `Q(n)` is the number of **maximum independent sets** of `Q_n` (when `α = n`).

Maximum-independent-set counting is #P-hard in general; the queens graph is a structured special case where the bitmask backtracking exploits the row decomposition. This is the graph-theoretic mirror of the completion hardness in Section 11: the unconstrained instance is structured enough to be easy to *witness*, but counting maximum independent sets remains hard.

---

## 11c. Closed Walks, Trace, and a Generating-Function Aside

Although N-Queens itself has no transfer-matrix closed form, a transfer-matrix view explains *why* counting is structured row-by-row.

Define, for each pair of "compatible" row states, a transition. A **row state** at row `r` is the triple of bitmasks `(cols, diag, anti)` reachable after placing queens in rows `0..r`. The number of solutions is the number of length-`n` paths in this enormous state graph from the empty state to a full-column state. The state space has size exponential in `n` (up to `2^n` column masks), which is exactly why no small transfer matrix — and hence no short closed form — exists. Contrast this with problems like counting domino tilings of an `n × k` strip with *fixed small* width `k`, where the transfer matrix is `O(2^k)` and a closed/linear-recurrence form does exist. For N-Queens the "width" of the relevant state is `n` itself, so the matrix is exponential and the technique collapses to plain search.

**Remark 11c.1 (no useful eigenvalue shortcut).** Because the transition matrix is exponential-sized and changes structure (the diagonal shifts) with depth, the spectral/closed-walk machinery that solves fixed-length-walk counting (see the `paths-fixed-length` topic) does not yield a polynomial method here. This is the formal reason N-Queens counting is fundamentally a search problem, not an algebra problem.

---

## 11d. Lower-Bound Intuition for the Search Tree

We give a back-of-the-envelope argument for why the visited tree is exponential but far below `n!`.

Heuristically, model column choices as random injective assignments. Placing the queen in row `r` must avoid the columns and diagonals used by the `r` prior queens. Of the `n - r` remaining columns, roughly a constant fraction are also diagonal-blocked, so the expected branching factor at depth `r` is approximately `(n - r) · ρ` for some `ρ ∈ (0, 1)`. Multiplying these branching factors across rows gives a product that behaves like `(cn)^n` for a constant `c < 1/e` after Stirling, matching the Simkin asymptotic rate `Q(n) = ((1+o(1))ne^{-α})^n` with `α ≈ 1.94` (so `e^{-α} ≈ 0.144`). This is heuristic — the diagonal constraints are not independent — but it correctly predicts: (1) exponential growth, and (2) a base well below `n`, i.e., aggressive pruning relative to the `n!` permutation tree (`α(perm) = 1` in the same notation, since `e^{-0} = 1` would give `n!`-like growth). The gap `e^{-1.94}` versus `1` quantifies the diagonal pruning's power.

---

## 11e. Detailed Burnside Computation for Small N

To make Theorem 9.1 concrete, we tabulate the fixed-point counts `|Fix(g)|` for the eight group elements and several `n`. Write the group as `{e, r₉₀, r₁₈₀, r₂₇₀, h, v, d, d'}` where `h, v` are the axis reflections and `d, d'` the diagonal reflections.

**General facts about the fixed sets.**

- `|Fix(e)| = Q(n)` always.
- `|Fix(h)| = |Fix(v)| = 0` for `n ≥ 2`. *Reason:* horizontal reflection sends the queen in row `r` to row `n-1-r` keeping its column; for a fixed solution, rows `r` and `n-1-r` would need queens in the *same* column, a column attack (unless `r = n-1-r`, the middle row, but a single self-paired queen cannot make the whole placement symmetric while avoiding the paired-row column clash). A careful parity argument gives 0.
- `|Fix(r₁₈₀)|` counts solutions invariant under 180° rotation. These pair up squares `(r,c) ↔ (n-1-r, n-1-c)`; a solution is fixed iff it is built from such non-attacking pairs (plus a center queen when `n` is odd). This count is positive for several `n`.
- `|Fix(r₉₀)| = |Fix(r₂₇₀)|` (they are inverses, equinumerous) count solutions with full 4-fold rotational symmetry; these are rare and require `n ≡ 0` or `1 (mod 4)`.
- `|Fix(d)| = |Fix(d')|` count solutions symmetric under a diagonal flip (transpose-type symmetry).

**Worked table.**

```
n   Q(n)  Fix(r90)+Fix(r270)  Fix(r180)  Fix(d)+Fix(d')   q(n)
4    2          0                0            0             1
5   10          0                2            0             2
6    4          0                0            0             1
7   40          0                4            0             6
8   92          0                4            0            12
```

For `n = 8`: `q(8) = (1/8)(92 + 0 + 4 + 0 + 0 + 0 + 0 + 0) = 96/8 = 12`. ✓ The "4" is `|Fix(r₁₈₀)|` — there are exactly four `n=8` solutions invariant under 180° rotation, forming one orbit of size 4 (since each is fixed by `r₁₈₀`, its orbit under D4 has size `8 / |stabilizer|`; with stabilizer `{e, r₁₈₀}` of order 2, orbit size is 4). The other 88 solutions form 11 orbits of size 8. Total orbits `11 + 1 = 12`. ✓

**Why naive division fails, restated formally.** `Q(n) = Σ_orbits |orbit|`. If all orbits had size 8, then `q(n) = Q(n)/8`. But the size-4 orbit means `Q(8) = 11·8 + 1·4 = 92`, and `92/8 = 11.5 ∉ ℤ`. Burnside corrects for the under-counting of small orbits exactly. ∎

## 11f. The Orbit-Stabilizer Connection

**Theorem 11f.1 (orbit-stabilizer).** For `σ ∈ Sol(n)`, `|orbit(σ)| · |Stab(σ)| = |D4| = 8`, where `Stab(σ) = { g : g·σ = σ }`.

*Proof.* Standard group action result: the map `g·Stab(σ) ↦ g·σ` is a bijection from left cosets of `Stab(σ)` to `orbit(σ)`; the number of cosets is `|D4|/|Stab(σ)|`. ∎

**Corollary 11f.2.** Orbit sizes are exactly the divisors of 8 that can occur: 8 (trivial stabilizer), 4 (stabilizer of order 2, e.g. `{e, r₁₈₀}`), 2 (stabilizer of order 4), 1 (stabilizer all of D4). A solution with orbit size 1 would be fixed by every symmetry — impossible for `n ≥ 2` because `h` fixes nothing (above). So orbit sizes are 8, 4, or 2 in practice, with 8 dominating.

This is the rigorous backbone of the "fundamental solutions" concept and explains why enumeration code must canonicalize (pick one representative per orbit) rather than divide.

## 11g. Relation to Latin Squares and Toroidal Queens

A variant sheds light on structure: the **toroidal** (modular) N-Queens places queens on a board where diagonals wrap around, i.e. attacks use `r - c (mod n)` and `r + c (mod n)`. Toroidal solutions exist iff `gcd(n, 6) = 1` (i.e. `n` coprime to 6), and when they exist they are highly regular — `σ(r) = (a·r + b) mod n` for suitable `a, b` gives a solution. Every toroidal solution is also an ordinary solution (wrapping only adds constraints), which yields an easy *constructive* family for `n` coprime to 6 and connects N-Queens to modular arithmetic and Latin squares (the placement matrix is a permutation matrix avoiding two "broken diagonal" families, akin to a Latin square's structure). The ordinary problem is harder precisely because it lacks the wrap-around regularity, which is why its count is irregular and formula-free.

## 11h. Counting Hardness in the Polynomial Hierarchy

We place the counting problem precisely.

- **Existence (`∃` solution):** in `P` (indeed `O(n)` constructive). Trivial decision.
- **Completion existence:** `NP-complete` (Thm 11.2).
- **Counting all solutions `Q(n)`:** the function is computable but no polynomial algorithm is known; the *completion-counting* version is `#P-complete`. The blank-board counting is widely believed not polynomial-time computable (it would imply unexpected collapses given the #P-completeness of the closely related completion-count).
- **Counting fundamental solutions `q(n)`:** reducible to counting all (via Burnside / canonicalization), so no easier asymptotically.

The membership of `Q(n)` computation in feasible classes is the open-ended part: we can compute it by search for small `n`, and we know its growth rate, but we have neither a polynomial algorithm nor a proof that none exists for the *unconstrained* count specifically. What is proven is the hardness of the *completion* and *completion-counting* variants, which is why those are the ones flagged as intractable in practice.

## 11i. Summary of the Proof Structure

The logical spine of this document, in dependency order:

1. **Def 1.1 + Lemma 1.2** establish that solutions are constrained permutations.
2. **Props 2.2–2.3 + Cor 2.4** prove the diagonal indices are exact, justifying `O(1)` checks.
3. **Invariant 5a.1 + Cor 5a.2** prove the bookkeeping stays correct under place/undo.
4. **Prop 3.2 + Thm 4.1** prove the search visits exactly the valid partial placements and is sound/complete; **Cor 4.2** extends this to exact counting.
5. **Lemma 6a.1 + Thm 6a.2** transfer correctness to the bitmask variant.
6. **Section 5–6 + 7a** characterize the search-tree size and the growth rate (no closed form).
7. **Thms 9.1, 11f.1** (Burnside, orbit-stabilizer) account for symmetry and fundamentals.
8. **Thm 10.1** gives existence; **Thm 11.2** gives completion hardness.

Each implementation choice (array keys, bitmask shifts, symmetry doubling) corresponds to a specific proposition above, so a failing test maps to a specific broken lemma.

## 11j. Deriving the Upper Bound `Q(n) ≤ ((1+o(1)) n e^{-α})^n`

Section 7a *quotes* the Simkin asymptotic rate; here we derive the structure of the **upper bound** (the easier direction, due to Luria), because the derivation reveals *which* counting argument produces the `e^{-α}` factor and is reusable for related constrained-permutation problems. We work with `ln Q(n)` throughout.

**Step 1 — the permutation ceiling.** By Prop 10c.1, `Q(n) ≤ n!`. Taking logs and Stirling:

```
ln n! = n ln n - n + O(ln n).
```

So `ln Q(n) ≤ n ln n - n + O(ln n)`. This already gives the leading `n ln n` term; the work is to sharpen the `-n` coefficient to `-α` with `α ≈ 1.94`, i.e. to account for the diagonals.

**Step 2 — the entropy / first-moment frame.** Model a uniformly random permutation `σ` of `[n]` and let `Q(n) = n! · Pr[σ avoids all diagonal collisions]`. The two diagonal families impose `r - σ(r)` all-distinct and `r + σ(r)` all-distinct. The upper bound comes from bounding this probability from above. Write the survival probability as `P_n`; then `ln Q(n) = ln n! + ln P_n`.

**Step 3 — bounding `P_n` via diagonal occupancy.** Consider just the main diagonals. The values `r - σ(r)` range over `2n - 1` possible diagonals, but the `n` queens must land on `n` *distinct* main diagonals (and likewise `n` distinct anti-diagonals). For a random permutation the expected number of distinct main-diagonal values is strictly below `n`, and a concentration/entropy argument bounds the probability that all `n` are distinct. The careful computation (Luria's, via the permanent of an associated 0/1 matrix and a Bregman–Minc / entropy estimate) yields

```
ln P_n  ≤  -(α - 1) n + o(n),     α ≈ 1.942,
```

so that the two diagonal constraints cost an extra `(α-1)n ≈ 0.94 n` in the log beyond the `-n` already in `ln n!`.

**Step 4 — combine.** Adding Steps 1 and 3:

```
ln Q(n)  ≤  (n ln n - n) + (-(α-1) n) + o(n)  =  n ln n - α n + o(n),
```

which exponentiates to `Q(n) ≤ ((1 + o(1)) n e^{-α})^n`. ∎ (upper bound)

**The lower bound (Simkin, 2021)** matches this rate. Its proof is substantially harder: it constructs exponentially many solutions via a random-greedy / absorption argument on the diagonals, showing the survival probability is *not* smaller than the upper bound up to the `o(n)` term. The matching of the two bounds is what upgrades "rate at most" to "rate exactly," giving `ln Q(n) = n ln n - α n + o(n)`.

**Worked sanity check against the table.** The asymptotic is for `n → ∞`, so it is only suggestive at `n = 14`, but the trend is visible. Using `ln Q(n) ≈ n ln n - α n` with `α = 1.94`:

```
n    n ln n      α·n      predicted ln Q     actual ln Q(n)
10   23.03      19.4         3.63              ln 724    = 6.58
12   29.82      23.3         6.52              ln 14200  = 9.56
14   36.95      27.2         9.75              ln 365596 = 12.81
```

The predicted values are systematically *below* the actual by roughly a constant offset (~3), which is exactly the `o(n)` lower-order term the asymptotic discards — it is not yet negligible at `n = 14`. The *slope* (how fast `ln Q` rises per unit `n`), however, already tracks `ln n - α + (1 + ln n)`-style growth, confirming the leading behavior. This is the honest way to relate an asymptotic rate to finite data: match slopes, not absolute values, and attribute the residual to `o(n)`.

**Why the derivation matters in practice.** The bound tells a senior engineer the precise, provable reason `N = 30` counting is infeasible: `ln Q(30) ≈ 30 ln 30 - 1.94·30 ≈ 102 - 58 = 44`, i.e. `Q(30) ≈ e^{44} ≈ 10^{19}` solutions, and the *search tree* visiting them is larger still. No constant-factor kernel (Section 9e of `senior.md`) dents an exponent of this size; only the leading `e^{-α}` pruning is "free," and it is already baked into the bitmask search. The bound is therefore not academic — it is the quantitative justification for refusing a "count solutions for `N = 30`" request and steering to the constructive or completion variant instead.

## 12. Summary

N-Queens solutions are exactly the permutations `σ` of `[n]` with `r - σ(r)` and `r + σ(r)` each all-distinct; one-per-row follows from pigeonhole (Lemma 1.2). The code's diagonal indices `r - c + n - 1` and `r + c` are bijections onto `{0,…,2n-2}` (Props 2.2–2.3), making the four attack types detectable by integer-key equality and the conflict check `O(1)` (Cor 2.4). Backtracking visits exactly the valid partial placements `⋃_k V_k` (Prop 3.2) and is therefore sound and complete (Thm 4.1); its tree sits strictly inside the permutation tree, which sits inside the `n^n` tree, and the diagonal pruning is what shrinks `n!` leaves to the tiny `Q(n)`. The count `Q(n)` is OEIS A000170 with **no closed form** (only an asymptotic rate); the fundamental count `q(n)` (A002562) is obtained via the D4 action and **Burnside's lemma**, not by dividing by 8 (which fails because symmetric solutions form smaller orbits). Existence holds for `n = 1` and all `n ≥ 4` by an `O(n)` construction, so *deciding* is trivial — yet **completion** of a partial board is NP-complete (#P-complete to count), locating all the difficulty in the constrained/counting variants.
