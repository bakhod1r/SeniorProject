# Sudoku Solver — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Sudoku as a Constraint Satisfaction Problem
3. Sudoku as Exact Cover
4. Algorithm X: Correctness and Dancing Links
5. MRV as a Search-Ordering Optimization
6. NP-Completeness of Generalized Sudoku
7. Counting Valid Grids
8. The Minimum-Clue (17) Result
9. Constraint Propagation as Local Consistency
10. Symmetry and the Structure of Solutions
10b. Constraint Graph and Coloring View
11. Complexity Landscape
12. Summary

---

## 1. Formal Definitions

Fix the order `n = 3`, so the grid is `N × N` with `N = n² = 9`. Index cells by `(r, c)` with `r, c ∈ {0, …, N-1}`.

**Definition 1.1 (Sudoku grid).** A *grid* is a partial function `g : {0,…,8}² → {1,…,9}`; cells outside the domain are *empty*. A *given* (clue) is a cell in the domain of the initial `g`.

**Definition 1.2 (Units).** The `27` *units* are the `9` rows `R_r = {(r, c) : c}`, the `9` columns `C_c = {(r, c) : r}`, and the `9` boxes `B_b = {(r, c) : (r/3)*3 + c/3 = b}`. Each cell lies in exactly one row, one column, and one box.

**Definition 1.3 (Validity).** A complete grid `g : {0,…,8}² → {1,…,9}` is *valid* iff every unit `U` satisfies `g|_U` is a bijection onto `{1,…,9}` — i.e. each digit appears exactly once in each row, column, and box.

**Equivalent characterizations of validity.** A complete grid is valid iff *any* of the following hold (each is a useful test in code or proof): (a) every row, column, and box is a permutation of `{1,…,9}`; (b) for every digit `d`, the nine cells holding `d` form a *permutation matrix* pattern — one per row, one per column, and one per box (this is the "exactly-once" view used in the exact-cover encoding of §3); (c) no two peers (Definition: cells sharing a unit) hold the same value (the graph-coloring view of §10b). The three are logically equivalent; (a) is the everyday check, (b) drives the exact-cover model, and (c) drives the coloring model.

**Definition 1.4 (Solution / proper puzzle).** A *solution* to a partial grid `g₀` is a valid complete grid `g ⊇ g₀` (agreeing with `g₀` on all givens). A puzzle is *proper* iff it has **exactly one** solution.

The word "proper" is load-bearing throughout: published Sudoku puzzles are *required* to be proper, because a human solver relies on every deduction being forced (a multi-solution puzzle would admit contradictory valid fills, defeating logical solving). This is why uniqueness checking (§6, §11.2) is not optional polish but a correctness requirement of generation — an improper "puzzle" is not a Sudoku at all in the conventional sense, merely a constraint instance with multiple completions.

**Definition 1.5 (Generalized Sudoku).** For arbitrary order `n`, the grid is `N × N` with `N = n²`, units defined analogously with `n × n` boxes; the digit alphabet is `{1, …, N}`. The decision problem **Sudoku** asks: given a partial `N × N` grid, does a valid completion exist?

**Proposition 1.6 (Solution count is well-defined).** For any partial grid `g₀`, the number of solutions is a finite non-negative integer, bounded above by the total number of valid grids (`6.671 × 10²¹` for `n=3`, Theorem 7.1). A puzzle is *proper* iff this count is exactly `1`; *over-determined / invalid* iff `0`; *ambiguous* iff `≥ 2`. *Proof.* Solutions are valid completions extending `g₀`, a subset of the finite set of valid grids; hence the count is finite and bounded. ∎

**Notation.** `N = n²` is the side length, `N² = n⁴` the number of cells (81 for `n=3`), `popcount` the number of set bits, and `[P]` the Iverson bracket (`1` if `P`, else `0`). "Candidate at `(r,c)`" means a digit clashing with no unit-mate. Throughout, the standard puzzle is `n = 3`, `N = 9`; complexity results concern `n → ∞`.

**Remark (Sudoku vs Latin square).** A **Latin square** of order `N` requires only the row and column bijections (no box constraint). Sudoku is a Latin square with the *additional* `n × n` box constraint. This is why Sudoku-completion NP-completeness (§6) reduces *from* Latin-square completion (Colbourn 1984): the box constraint is added by a gadget, and dropping it recovers the Latin-square problem. Every result in this document specializes to Latin squares by deleting the box-number constraint family (reducing the exact-cover universe from `4N²` to `3N²` elements). The box constraint makes Sudoku strictly more constrained, which is *good* for solvers (more pruning) but does not lower the worst-case complexity.

---

## 2. Sudoku as a Constraint Satisfaction Problem

A **constraint satisfaction problem (CSP)** is a triple `(X, D, C)`: variables `X`, domains `D`, constraints `C`.

**Sudoku as a CSP.** Variables are the `81` cells; each domain is `{1,…,9}` (givens have singleton domains); constraints are `AllDifferent` over each of the 27 units. Equivalently, the binary form has a `≠` constraint between every pair of cells sharing a unit.

**Worked CSP framing of a single cell.** Take an empty cell `x = (4, 4)` (center of the grid). Its CSP domain starts as `{1,…,9}`. Each given in row 4, column 4, or the center box removes a value from `x`'s domain (a unary consequence of the binary `≠` constraints with those filled peers). If the surviving domain is a singleton, `x` is determined without search — a naked single, in CSP terms a variable whose domain collapsed under forward checking. If it is empty, the partial assignment is inconsistent — a dead end, detected by forward checking before any deeper search. This is the precise CSP vocabulary for the bitmask `candidates(r,c)` computation of `junior.md`: the candidate mask *is* the current CSP domain of the cell.

**Proposition 2.1.** A complete assignment satisfies all `AllDifferent` unit constraints iff the grid is valid (Definition 1.3).

*Proof.* `AllDifferent` on a 9-cell unit with alphabet `{1,…,9}` forces a bijection (9 distinct values into 9 slots from a 9-element set), which is exactly Definition 1.3's bijection condition. Conversely a valid grid has each unit a bijection, hence all-different. ∎

This CSP view is the conceptual home of the solving techniques: **backtracking search** is the generic CSP solver; **MRV** is the standard *most-constrained-variable* ordering heuristic; **constraint propagation** (naked/hidden singles) is *local consistency enforcement* (a restricted form of arc/path consistency). Sudoku is a finite-domain CSP, so backtracking with propagation is complete and terminates.

**The arc-consistency hierarchy, named.** In CSP terms, the Sudoku techniques form a ladder of *consistency levels*: **node consistency** (a single variable's domain respects unary constraints — trivial here since givens are fixed), **forward checking** (after assignment, prune peers' domains — the bitmask update), **arc consistency / AC-3** (every value of every variable has a support in each constraint), and **generalized arc consistency (GAC)** on the global `AllDifferent` (Régin's matching algorithm). Higher levels prune more but cost more per node. The bitmask MRV solver sits at "forward checking + most-constrained-variable," the cheap-but-effective sweet spot; difficulty raters and the hardest puzzles push toward GAC.

### 2.1 Counting the constraints

The binary `≠` form has a constraint between every pair of cells sharing a unit. Each cell shares a row with `8` others, a column with `8` others, and a box with `8` others, but the `4` cells that are *both* box-mates and row/column-mates are double counted. The number of *peers* of a cell is therefore `8 + 8 + 8 - 4 = 20`, and the total number of binary `≠` constraints is `(81 × 20)/2 = 810`. The 27 `AllDifferent` constraints are a more compact (and more propagation-friendly) encoding of these `810` binary constraints — a constraint-modeling lesson that recurs throughout CSP work: global constraints prune more than their binary decompositions because a filtering algorithm can reason about the whole unit at once (e.g. Régin's matching for `AllDifferent`, §9).

### 2.2 Domain size and the search-space bound

A naive upper bound on the search tree: each of the `81 - g` empty cells (with `g` givens) has at most `9` values, giving `≤ 9^{81-g}` leaves. For a 17-clue puzzle that is `9^{64} ≈ 10^{61}` — astronomically larger than the actual node count of a few hundred under MRV. The gap between this bound and reality is precisely the value delivered by pruning (legality checks cut illegal branches) and ordering (MRV minimizes branching). This is the quantitative version of the qualitative claim "MRV + propagation makes 9×9 trivial."

A sharper (still loose) bound multiplies the *actual* domain sizes rather than `9` uniformly: `∏_{empty (r,c)} |domain(r,c)|`, where each domain is shrunk by the givens. Even this product, computed at the root, vastly overestimates the search because each placement further shrinks neighbors' domains (forward checking) — an effect the static product ignores. The true node count is governed by the *dynamic* domain sizes encountered during search, which MRV drives toward `1` (forced) as fast as possible. No closed-form expresses the realized node count; it is an empirical property of the instance, which is exactly why the benchmark task (`tasks.md` Task B) measures it rather than deriving it.

---

## 3. Sudoku as Exact Cover

The **exact cover** problem: given a finite set `U` (the *universe*) and a collection `S` of subsets of `U`, find `S* ⊆ S` such that every element of `U` lies in **exactly one** set of `S*`. Equivalently, with a 0/1 matrix whose columns are `U` and rows are the sets `S`, select rows so each column has exactly one `1`.

**Sudoku's exact-cover encoding.** The universe `U` has `4N² = 324` elements (for `N=9`), partitioned into four constraint families of `N² = 81` each:

| Family | Element `u` means | Count |
|--------|-------------------|-------|
| Cell | "cell `(r,c)` is filled" | 81 |
| Row-number | "row `r` contains digit `d`" | 81 |
| Column-number | "column `c` contains digit `d`" | 81 |
| Box-number | "box `b` contains digit `d`" | 81 |

Each candidate set `S_{r,c,d}` = "place digit `d` at cell `(r,c)`" covers exactly **four** elements: `Cell(r,c)`, `RowNum(r,d)`, `ColNum(c,d)`, `BoxNum(box(r,c),d)`. There are `N³ = 729` such candidate sets.

**Theorem 3.1.** Valid complete Sudoku grids are in bijection with exact covers of `U` by `{S_{r,c,d}}`.

*Proof.* Given a valid grid, take `S* = {S_{r,c,g(r,c)} : (r,c)}`. Each `Cell(r,c)` is covered exactly once (one digit per cell — the cell constraint). Each `RowNum(r,d)` is covered exactly once because in a valid grid digit `d` appears exactly once in row `r` (the row bijection), and that occurrence is the unique `(r,c,d)` in `S*` covering `RowNum(r,d)`; symmetrically for columns and boxes. Hence `S*` is an exact cover. Conversely, an exact cover selects, for each `Cell(r,c)`, exactly one `S_{r,c,d}` (cell column covered once), defining a total function `g(r,c)=d`; the row/column/box columns being covered exactly once forces each digit once per unit, i.e. validity. The maps are mutually inverse. ∎

Givens are imposed by pre-selecting their candidate rows (or deleting all conflicting candidate rows and the covered columns) before searching. This theorem is the formal justification for the DLX solver of `senior.md`: solving Sudoku *is* solving an exact-cover instance.

### 3.1 Worked encoding of a single placement

Take the placement "digit `7` at cell `(2, 4)`." Its box is `b = (2/3)*3 + 4/3 = 0*3 + 1 = 1`. Encoding the four constraint families as offsets `0, 81, 162, 243` and indexing within each family, the candidate row sets exactly these four columns:

```
Cell(2,4)      → 0   + 2*9 + 4  = 22
RowNum(2,7)    → 81  + 2*9 + 6  = 105   (digit 7 → index 6)
ColNum(4,7)    → 162 + 4*9 + 6  = 204
BoxNum(1,7)    → 243 + 1*9 + 6  = 258
```

So the candidate row for `(r,c,d) = (2,4,7)` is the 0/1 row with 1s in columns `{22, 105, 204, 258}` and 0 elsewhere. Exactly `729` such rows exist (one per `(r,c,d)`), and an exact cover selects `81` of them (one per cell column) with every column covered once. A given `g(2,4)=7` is imposed by pre-selecting this row and removing all rows conflicting with it (any other digit at `(2,4)`, any `7` elsewhere in row 2 / column 4 / box 1).

### 3.2 Why "exactly one," not "at least one"

The cell family (`Cell(r,c)`) enforces *at most one* digit per cell from above and *at least one* from the exact-cover requirement (every column covered) — together, *exactly one*. The number families enforce each digit *exactly once* per unit. Dropping the cell family would permit empty cells; dropping a number family would permit a digit to repeat in a unit. All four families are required for Theorem 3.1's bijection to hold — the formal counterpart of "all three Sudoku rules are mandatory" from `junior.md`.

### 3.3 Size of the exact-cover instance

For order `n`, the universe has `4N² = 4n⁴` elements and there are `N³ = n⁶` candidate rows, each with exactly `4` ones. For `n = 3`: `324` columns, `729` rows, `4 × 729 = 2916` ones total — a sparse matrix with density `2916 / (324 × 729) ≈ 1.2%`. This sparsity is what makes Dancing Links efficient: cover/uncover touch only the few nonzero entries, and the linked structure stores only the `2916` nodes plus headers, never the `236,196` zero cells. A dense-matrix exact-cover solver would waste almost all its work on zeros; DLX's sparse representation is the right data structure for exactly this density regime, and it is why Knuth introduced it specifically for such combinatorial-search matrices.

### 3.4 Generalization to `N²×N²` and other puzzles

The encoding generalizes verbatim: for order `n`, four families of `N²` columns and `N³` rows, each row covering its cell, row-number, column-number, and box-number constraints. The *same* DLX engine solves any order by changing only the matrix dimensions. More broadly, *any* problem expressible as exact cover — polyomino/pentomino tiling, the N-queens problem (as a cover of rank/file/diagonal constraints), graceful labelings — reuses the identical Algorithm X core; only the matrix-construction step differs. This universality is the practical reason DLX is worth implementing once and reusing, and it is the formal sense in which Sudoku is "just an exact-cover instance."

---

## 4. Algorithm X: Correctness and Dancing Links

**Algorithm X (Knuth).** To find an exact cover of matrix `M`:

```
SEARCH(M):
  if M has no columns: report current partial solution; return
  choose a column c (deterministically)
  if column c has no rows: return            # dead end, backtrack
  for each row r with M[r][c] = 1 (try each):
    include r in the partial solution
    for each column j with M[r][j] = 1:
      for each row i with M[i][j] = 1: delete row i from M
      delete column j from M
    SEARCH(reduced M)                          # recurse
    undo the deletions; remove r from partial solution   # backtrack
```

**Theorem 4.1 (Correctness).** `SEARCH` enumerates exactly the exact covers of `M`.

*Proof sketch.* By induction on the number of columns. Base: no columns ⇒ the empty selection covers the empty universe — report it. Step: pick column `c`. Any exact cover must cover `c` by exactly one row `r` with `M[r][c]=1`; the algorithm branches over all such `r` (completeness — no cover is missed) and they are mutually exclusive choices for covering `c` (soundness — no cover is double-counted). Selecting `r` forces, by the exact-cover constraint, that every other column `j` touched by `r` is now satisfied and may be removed, and every row `i` conflicting with `r` (sharing a satisfied column) must be deleted to maintain the "exactly one" invariant. The reduced matrix's exact covers, together with `r`, are precisely the covers of `M` containing `r`. Summing over the disjoint choices of `r` gives all covers of `M`. Termination: each recursion strictly reduces the column count. ∎

**Dancing Links (DLX)** implements the deletions on a sparse circular doubly-linked structure. The key identities, for a node `x` with vertical neighbors:

- **Cover (remove):** `x.up.down ← x.down; x.down.up ← x.up`. The node `x` is unlinked but *retains its own* `up`/`down` pointers.
- **Uncover (restore):** `x.up.down ← x; x.down.up ← x`. Because `x` still points to its old neighbors, restoration is exact and `O(1)`.

**Lemma 4.2 (Reversibility).** If columns/rows are uncovered in the exact reverse order they were covered, the structure returns bit-for-bit to its prior state.

*Proof.* Each cover splices a node out using only its neighbors' pointers; the node's own pointers are untouched. Uncovering in reverse order restores each splice against the same neighbors it was removed from, and since no intervening operation altered `x.up`/`x.down`, the writes `x.up.down ← x` and `x.down.up ← x` re-create the original links. By induction over the reversed sequence the whole structure is restored. ∎

This is why DLX backtracking is allocation-free and `O(1)` per link operation — the formal content of "the links dance." Lemma 4.2 is also the precise statement of the `senior.md` failure mode "uncover in reverse order of cover."

### 4.1 Worked cover/uncover trace

Consider a column `c` linked vertically as header `→ x → y → z → (back to header)`. To cover `c` we splice out each row node touching `c`. Removing node `x` (with vertical neighbors `header` above and `y` below) executes:

```
x.up.down  = x.down     →  header.down = y
x.down.up  = x.up       →  y.up = header
```

Now traversing the column skips `x`, but `x.up` still equals `header` and `x.down` still equals `y`. Later, uncovering restores `x` by:

```
x.up.down  = x          →  header.down = x
x.down.up  = x          →  y.up = x
```

re-inserting `x` exactly between its original neighbors. Because the cover loop removed `x` *before* `y`, the uncover loop must restore `y` *before* `x` (reverse order) so that when `x` is reinserted, `y.up` is set to `x` and not left dangling. Reverse-order restoration is not an optimization but a *correctness requirement* (Lemma 4.2); doing it forward corrupts the structure — the subtle bug that the `senior.md` failure-mode list calls out.

### 4.1b Small worked exact cover (toy)

To see Algorithm X end to end on a tiny instance, take universe `U = {1,2,3,4,5,6,7}` and sets:

```
A = {1, 4, 7}
B = {1, 4}
C = {4, 5, 7}
D = {3, 5, 6}
E = {2, 3, 6, 7}
F = {2, 7}
```

Algorithm X picks the column with the fewest sets covering it. Column `1` is in `{A, B}`, column `2` in `{E, F}`, column `3` in `{D, E}`, column `5` in `{C, D}`, column `6` in `{D, E}`, column `7` in `{A, C, E, F}`, column `4` in `{A, B, C}`. Suppose ties are broken to pick column `1` (size 2). Branch on `B = {1,4}`: cover columns `1, 4` and the sets touching them (`A, C`). Remaining universe `{2,3,5,6,7}`, sets `{D, E, F}`. Now column `5` is in only `{D}`; pick it, branch on `D = {3,5,6}`: cover `3,5,6` and sets touching them (`E`). Remaining `{2,7}`, sets `{F}`. `F = {2,7}` covers both; the universe empties. Solution: `{B, D, F}` — and indeed `B ∪ D ∪ F = {1,4} ∪ {3,5,6} ∪ {2,7} = U` with no overlaps. This is exactly the recursion the Sudoku DLX solver runs, only with `324` columns and `729` candidate rows instead of `7` and `6`.

### 4.2 Complexity of one DLX solve

Each `cover`/`uncover` of a column touches every node in that column and, for each, every node in that node's row. For Sudoku, columns have at most `9` rows and rows have exactly `4` columns, so a cover is `O(9 × 4) = O(1)` for fixed size. The number of `cover`/`uncover` pairs is proportional to the search-tree node count, which MRV-style smallest-column selection keeps small. The asymptotic worst case is still exponential (it is solving an NP-complete problem, §6), but the *constant factor* is excellent: no allocation, pointer-only updates, and cache-friendly traversal of short linked lists.

When the chosen column has **zero** rows (no candidate can satisfy that constraint), Algorithm X returns failure immediately — the exact-cover analog of a zero-candidate cell in the grid solver. Choosing the smallest column makes such empty columns the *first* to be selected, so contradictions are detected at minimal depth, mirroring MRV's early-contradiction property (§5). This is why Knuth's "fewest 1s" rule is not merely a speed tweak but the structural reason DLX prunes as aggressively as a grid solver with MRV: both are instances of the most-constrained-choice principle, and both detect infeasibility as shallowly as the problem allows.

---

## 5. MRV as a Search-Ordering Optimization

Algorithm X says "choose a column `c` (deterministically)." Knuth's recommended rule: pick the column with the **fewest 1s** (the *S-heuristic*). In the grid formulation this is exactly **MRV** — pick the cell (or constraint) with the fewest remaining options.

**Proposition 5.1 (Correctness invariance).** Any deterministic column-choice rule yields the same *set* of exact covers; the choice affects only the search-tree shape, not the result.

*Proof.* Theorem 4.1's induction never used *which* column was chosen, only that exactly one is chosen and branched over completely. Hence every rule enumerates the same covers. ∎

This is the exact-cover restatement of the grid-solver fact that MRV "does not change correctness, only the tree shape" (`middle.md`). It is worth stressing because it is *the* license to optimize freely: you may swap in any cell/column-selection rule — fewest candidates, random, fixed order, degree-weighted — and still get every solution exactly once. Only the performance changes. No ordering heuristic can ever produce a wrong or missing solution; the worst a bad heuristic can do is be slow.

**Why fewest-options minimizes branching.** The number of children of a node equals the number of rows covering the chosen column (the branching factor). Choosing the minimum-`1s` column minimizes the immediate branching factor at that node. Two structural payoffs:

1. **Forced moves are free.** A column with a single `1` (a cell with one candidate, or a digit fitting one place — a naked/hidden single) has branching factor `1`: the search advances without splitting. MRV performs all forced moves before any real guess, embedding constraint propagation into the ordering.
2. **Early contradiction detection.** A column with **zero** `1`s (a cell with no candidate, or a digit with no legal cell) is detected immediately because it has the minimum count, pruning the subtree at the shallowest depth.

**Remark (no optimality guarantee).** MRV is a *heuristic*: it is not guaranteed to minimize total nodes over the whole tree (that would require lookahead). Constructed worst cases exist. But for Sudoku it is empirically dominant, and it is provably correct (Proposition 5.1) regardless of effectiveness — you can never get a *wrong* answer from a bad ordering, only a slower one. This separation of correctness (invariant) from performance (heuristic) is the formal reason MRV is "safe to always apply."

### 5.1 The degree heuristic as a tie-break

When several cells tie for the minimum candidate count, the **degree heuristic** breaks ties by choosing the cell involved in the most constraints on *other unfilled* cells (the most unfilled peers). Intuitively, fixing a high-degree cell propagates the most information. Formally it is still a search-ordering choice (Proposition 5.1 applies — correctness is untouched), and it offers a modest empirical improvement over arbitrary tie-breaking on the hardest instances. In the exact-cover view, the analog is breaking column-size ties by the column whose rows most constrain the remaining matrix. Production solvers usually find the plain MRV win dominant and the degree tie-break a minor refinement.

### 5.2 Forward checking and the propagation connection

MRV pairs naturally with **forward checking**: after assigning a cell, immediately remove the assigned value from the candidate sets of its peers, and fail early if any peer's domain empties. In the bitmask representation this is exactly the incremental mask update of `middle.md` — setting the digit bit in the row/column/box masks *is* forward checking, and a peer with `candidates == 0` is the emptied domain. Thus the bitmask MRV solver of `junior.md`/`middle.md` is, in CSP terms, **backtracking + forward checking + MRV**, the textbook strong-but-cheap combination. Heavier propagation (singles, GAC) goes beyond forward checking by deducing forced values rather than only pruning domains.

---

## 6. NP-Completeness of Generalized Sudoku

For the fixed `9×9` size, the number of grids is finite, so "Sudoku" is not asymptotically interesting — any bounded algorithm is `O(1)`. Complexity is studied for the **generalized** `N × N` problem (Definition 1.5).

**Why fixed size is uninteresting asymptotically.** For `n = 3` the problem has a constant number of possible inputs (at most `10^{81}` grids), so *any* terminating algorithm is `O(1)` by a lookup-table argument — complexity theory has nothing to say about the `9×9` puzzle as an asymptotic object. To get a meaningful complexity question we must let the board grow, which is exactly Definition 1.5. This is a standard move (the same one used to analyze chess, Go, and other fixed games via their `n × n` generalizations) and the source of frequent confusion: the `9×9` puzzle you solve at breakfast is trivially easy in the formal sense; only the infinite family is hard.

**Theorem 6.1 (Yato & Seta, 2003).** Deciding whether an `N×N` generalized Sudoku (with `n×n` boxes, `N=n²`) has a valid completion is **NP-complete**.

*Proof idea.* Membership in NP: a completed grid is a polynomial-size certificate checkable in `O(N²)` by scanning all units for the bijection property. NP-hardness: by reduction from **Latin square completion**, which Colbourn (1984) proved NP-complete; the box constraint is handled by a gadget construction. Yato & Seta additionally proved the *another-solution* problem (ASP) for Sudoku — "given a puzzle and one solution, is there a second?" — is **NP-complete** (ASP-complete), which is the formal hardness underlying *uniqueness checking*. ∎

**Consequences.**
- No polynomial-time algorithm for generalized Sudoku is known (and none exists unless `P = NP`). Backtracking's exponential worst case is therefore unsurprising and, modulo `P = NP`, unavoidable in the worst case.
- The hardness of the another-solution problem means verifying a puzzle is proper is, in the generalized setting, as hard as solving — there is no shortcut to uniqueness beyond essentially searching for a second solution (which is why `senior.md`'s generator caps the count at 2 and pays for a real search).
- The fixed `9×9` puzzle is trivially in `P` (constant size); the NP-completeness is a statement about the *family*, and it explains why the algorithmic toolkit (CSP search, propagation, exact cover) is the same one used for NP-hard problems generally.

### 5.3 Relationship to value ordering

MRV is *variable* ordering (which cell to fill next). The orthogonal choice is *value* ordering (which digit to try first in that cell). The **least-constraining-value** heuristic tries the digit that rules out the fewest options for the cell's peers, on the theory that it most likely leads to a solution and thus reaches a leaf faster on satisfiable instances. For *solving* a proper puzzle, value ordering offers modest gains; for *enumerating all* solutions or *proving* unsatisfiability it does not help (every value must be tried). Like variable ordering, value ordering is correctness-invariant (Proposition 5.1 extends trivially — reordering the loop over candidates cannot change the set of solutions found). For Sudoku, MRV variable ordering dominates; value ordering is a minor secondary tweak, which is why the solvers in `junior.md`/`middle.md` iterate candidate bits in numeric order without loss.

### 6.1 The reduction chain in more detail

The standard hardness argument is a chain of polynomial reductions:

```
3-SAT  ≤ₚ  Tripartite/3-Dimensional Matching  ≤ₚ  Latin-square completion  ≤ₚ  Sudoku completion
```

- **Latin-square completion** (partially filled `N×N` array, complete to a Latin square) is NP-complete (Colbourn 1984), itself proven via a reduction from a matching/coloring problem.
- **Sudoku ≥ Latin square:** an instance of Latin-square completion is encoded as a generalized Sudoku where the box constraint is made vacuous or satisfiable by a gadget, so a Sudoku completion exists iff the Latin-square completion does. Hence Sudoku completion is NP-hard.
- **Membership in NP:** a claimed completion is verified in `O(N²)` by checking the `3N` (Latin) or `4N`... here `3N²` peer relations — polynomial — so Sudoku completion is in NP, hence NP-complete.

The **another-solution problem (ASP)** reduction (Yato-Seta) is subtler: it shows that for problems whose solutions form an "ASP-reducible" structure, deciding whether a *second* solution exists is NP-complete. Sudoku is ASP-NP-complete, formalizing that uniqueness testing is not easier than solving.

This ASP hardness has a direct engineering consequence that recurs across `senior.md`: a generator cannot "know" a puzzle is proper by any cheap structural check — it must run a (capped) search for a second solution after every dig. There is no polynomial certificate of uniqueness (unless `P = NP`), so the cap-at-2 counter is provably the right approach, doing the minimum search the hardness permits. Contrast this with *solving* (find one solution), which at least has a short certificate (the solved grid); *uniqueness* has no analogously short "this is the only one" certificate.

### 6.2 What NP-completeness does and does not say about your solver

A frequent misreading: "Sudoku is NP-complete, so my solver might hang forever." For the **fixed `9×9`** puzzles humans play, the instance is constant-size — there is no asymptotic blowup, and a correct backtracking solver always terminates quickly. NP-completeness constrains the *generalized family* (`n → ∞`) and tells you three useful things: (1) do not expect a clever polynomial algorithm that obviates search; (2) worst-case adversarial *large* boards can be exponential; (3) the right engineering response is exactly what this topic teaches — strong pruning and ordering to keep the constant small, since the complexity class cannot be improved. It says nothing alarming about the `9×9` case.

---

## 7. Counting Valid Grids

**Theorem 7.1 (Felgenhauer & Jarvis, 2005).** The number of valid complete `9×9` Sudoku grids is

```
6,670,903,752,021,072,936,960  ≈  6.671 × 10²¹.
```

*Method.* Felgenhauer and Jarvis fixed the top band (the first three rows, in particular a canonical first box) and enumerated the completions by computer, using symmetry to collapse the count of band configurations to a manageable number, then multiplied through. The figure equals `9! × 72² × 2⁷ × 27,704,267,971` — the last factor being the number of essentially distinct band-completion classes, the product of a substantial computer search.

**Theorem 7.2 (Russell & Jarvis, 2006).** Up to the symmetry group of Sudoku (relabeling digits, permuting rows/columns within bands/stacks, permuting bands/stacks, transposition, and rotations/reflections), the number of *essentially different* grids is

```
5,472,730,538.
```

*Method.* Burnside's lemma (orbit counting) applied to the symmetry group of order `3,359,232 = 9! × 72² × 2`. Dividing the raw count by the group order and correcting for fixed points via Burnside gives the essentially-different count.

**Note on "essentially different."** Two grids are *essentially the same* if one maps to the other under a Sudoku symmetry. The `5.47 × 10⁹` figure counts equivalence classes (orbits), so it is the number of grids that differ in structure rather than mere relabeling/rearrangement — the meaningful "how many genuinely distinct Sudoku grids exist" answer. The raw `6.671 × 10²¹` overcounts each essential grid by (on average) the group order, modulo the rare fixed points that Burnside corrects for.

**Context.** These counts matter operationally: a uniqueness checker must *never* try to enumerate all solutions of a sparse grid (there are up to `~6.67 × 10²¹` completions of the empty grid), which is why solution counting is capped at 2 (`middle.md`, `senior.md`). The number also bounds information content: a random full grid carries `log₂(6.67 × 10²¹) ≈ 72.6` bits.

### 7.1 Sketch of the band-reduction count

The `9!` factor is the number of ways to fill the first box (any permutation of 1-9). Fixing the first box to the identity permutation, Felgenhauer and Jarvis enumerated completions of the rest of the top band (boxes 1 and 2 of the first three rows). Constraints between boxes in a band sharply limit the configurations; using symmetry to group equivalent band fillings, they reduced the count of distinct top-band classes to a tractable list, and for each computed how many full-grid completions exist by a constrained search. Multiplying the `9!` first-box choices by the (symmetry-collapsed) band completions and the per-band completion counts yields `6,670,903,752,021,072,936,960`. The computation was feasible on 2005 hardware precisely because symmetry collapsed an otherwise hopeless enumeration — a recurring theme: the symmetry group (§10) is the lever that makes counting tractable.

### 7.2 Why the empty grid must never be "counted"

A solution counter that does not cap will, on the empty grid, recurse into all `6.67 × 10²¹` completions — at a billion per second that is over `200,000` years. The `limit = 2` cap (`middle.md`) reduces the empty-grid query to "find any two completions," which MRV does in microseconds. This is the operational reason Theorem 7.1's magnitude is quoted in the engineering docs: it is the size of the catastrophe that capping averts.

### 7.3 The Latin-square comparison

Latin squares (rows + columns only, no box) of order `9` number `5,524,751,496,156,892,842,531,225,600 ≈ 5.52 × 10²⁷` — about a million times *more* than Sudoku grids, precisely because the box constraint eliminates most Latin squares (only the fraction satisfying all nine box bijections survive). The ratio quantifies how much the box constraint prunes: roughly `5.52 × 10²⁷ / 6.67 × 10²¹ ≈ 8.3 × 10⁵`. This is the combinatorial counterpart of the engineering observation that adding the box constraint to a Latin-square solver dramatically reduces its search — more constraints, more pruning, fewer valid completions. The general lesson for constraint modeling: extra valid constraints shrink the solution space geometrically and accelerate search, even though they do not change the worst-case complexity class.

---

## 8. The Minimum-Clue (17) Result

**Theorem 8.1 (McGuire, Tugemann & Civario, 2012).** There exists no proper (unique-solution) `9×9` Sudoku puzzle with **16 or fewer** clues; proper puzzles with exactly **17** clues exist (many are known). Hence **17 is the minimum number of clues** for a proper Sudoku.

*Method.* An exhaustive computer search. The key reduction: a 16-clue proper puzzle would have to be an "unavoidable-set hitting set" of size 16, where an **unavoidable set** is a subset of a solved grid's cells whose values can be permuted to give another valid grid — every proper puzzle must include at least one clue from each unavoidable set (otherwise the two completions would both satisfy the puzzle, violating uniqueness). The authors enumerated (a transformed representative set of) the `5,472,730,538` essentially-different grids and, for each, used a highly optimized hitting-set checker (their "checker" algorithm, itself a DLX-style exact-cover search) to verify no 16-clue subset hits all unavoidable sets. The computation took roughly 7 million core-hours.

**The 17-clue puzzle, in context.** A widely circulated example 17-clue proper puzzle demonstrates that the bound is achieved, not merely a non-existence result for 16. Such puzzles have only 17 of 81 cells filled — about 21% — yet a unique completion. Solving them by hand is genuinely hard precisely because there is so little to propagate from initially; an MRV+propagation solver handles them in milliseconds, while a fixed-order solver may struggle, making them the canonical stress test in `tasks.md` Task B.

**Significance.**
- It bounds how aggressively a generator can dig: digging below 17 clues *cannot* preserve uniqueness, so a dig-out generator (`senior.md`) will always re-insert when it would drop below the feasible minimum for that grid (which may be well above 17).
- 17-clue puzzles are the hardest class for solvers in the sense of fewest constraints to propagate from — exactly where MRV's early-contradiction advantage over fixed-order matters most.
- Note that "17 clues" is the *minimum over all proper puzzles*; a *particular* solved grid may have no 17-clue proper puzzle at all (its minimum hitting set may be 18, 19, …). The 17 is achieved only by special grids. Most random dig-out generators settle in the low-to-mid 20s before further removal breaks uniqueness, never approaching 17.
- The proof technique (unavoidable sets + exact-cover hitting-set search) is a beautiful application of the same exact-cover machinery (§3-§4) used to *solve* Sudoku, now used to *reason about* the space of puzzles.

### 8.1 Worked unavoidable set (size 4)

Take any solved grid and find two rows `r₁, r₂` and two columns `c₁, c₂` such that the four cells at their intersections contain only two digits arranged as a "swap pattern":

```
(r₁, c₁) = a    (r₁, c₂) = b
(r₂, c₁) = b    (r₂, c₂) = a
```

These four cells form an **unavoidable rectangle** (a "deadly pattern"): swapping `a ↔ b` at these four cells produces a *different* valid grid (the swap keeps every row, column, and box a permutation, because both `a` and `b` already appear once in each affected unit and only trade places). By Proposition 10.1, any proper puzzle must include at least one clue among these four cells — otherwise both the original and the swapped grid satisfy it. This size-4 unavoidable set is the smallest possible, and avoiding it is exactly the human "unique rectangle" technique: if a solver spots three corners of such a rectangle with the right candidates, the fourth is forced (assuming the puzzle is proper).

### 8.2 The hitting-set framing of the 17-clue search

Let `𝒰 = {U₁, U₂, …}` be the family of unavoidable sets of a solved grid `g`. A clue set `P` is proper (for `g`) iff `P ∩ Uᵢ ≠ ∅` for every `i` — a **hitting set** of `𝒰`. The minimum proper-puzzle size for `g` is the minimum hitting-set size of `𝒰`. McGuire et al. computed, over a representative set of all essentially-different grids, that no grid admits a hitting set of size `≤ 16`, while many admit size-17 hitting sets. The hitting-set checker is itself an exact-cover / set-cover search (an NP-hard subproblem solved per grid with heavy optimization), making the 17-clue theorem a `~7`-million-core-hour exact-cover computation about exact-cover puzzles.

---

## 9. Constraint Propagation as Local Consistency

Constraint propagation (naked/hidden singles, locked candidates) is the CSP notion of **enforcing local consistency** before/within search.

**Definition 9.1 (Naked single).** A cell whose candidate set (digits not used by any unit-mate) is a singleton `{d}`. By unit `AllDifferent`, `d` is forced.

**Definition 9.2 (Hidden single).** A digit `d` and unit `U` such that `d` is a candidate in exactly one empty cell of `U`. Since `d` must appear once in `U` (bijection), it is forced into that cell.

**Proposition 9.3 (Soundness).** Placing a naked or hidden single never removes a solution.

*Proof.* For a naked single `{d}` at cell `x`: any solution assigns `x` some value not clashing with its unit-mates, and `d` is the only such value, so every solution assigns `x = d`. For a hidden single: every solution must place `d` somewhere in `U`; the only candidate cell is `x`, so every solution has `g(x)=d`. In both cases the placement is implied by all solutions — pruning the other branches loses none. ∎

**Local consistency hierarchy.** Naked singles correspond to *node consistency* on the implied domains; hidden singles and locked candidates push toward *arc/path consistency* restricted to the `AllDifferent` structure. Full **generalized arc consistency (GAC)** on `AllDifferent` (Régin's matching-based algorithm) subsumes naked/hidden singles and many human techniques; running GAC to a fixpoint at each node yields a powerful but heavier solver. Practical Sudoku solvers use the cheap singles plus MRV search rather than full GAC, because for `9×9` the search after MRV is already tiny — the engineering trade-off `senior.md` discusses, here given its CSP name.

**Termination.** Propagation reaches a fixpoint in `O(N²)` placements (each cell filled at most once) times the per-sweep cost; it is monotone (placements only shrink candidate sets), so the fixpoint loop terminates.

### 9.1 Naked and hidden singles are dual

There is a clean duality between the two single rules. A **naked single** says: in the cell-vs-digit incidence within a unit, a *cell* has exactly one available digit. A **hidden single** says: a *digit* has exactly one available cell. They are the row- and column-views of the same bipartite "which digits can go in which cells of this unit" incidence structure. Régin's `AllDifferent` filtering generalizes both: it computes a maximum matching in this bipartite graph and removes any (cell, digit) edge that belongs to no maximum matching, which subsumes naked singles, hidden singles, and locked candidates in one polynomial-time algorithm. The reason practical solvers do *not* run full GAC at every node is the §11 complexity picture: for `9×9`, MRV search after cheap singles already visits so few nodes that the heavier per-node filtering does not pay off — a quantitative trade-off, not a theoretical limitation.

### 9.2 Propagation does not change the solution set

**Proposition 9.4.** Running naked/hidden single propagation to a fixpoint on a partial grid `g₀` yields a partial grid `g₁ ⊇ g₀` with exactly the same set of solutions.

*Proof.* Each individual placement is sound (Proposition 9.3) — it is implied by every solution, so adding it removes no solution and (being a forced consequence) adds no new constraint not already implied. By induction over the sequence of placements to the fixpoint, `g₁` and `g₀` have identical solution sets. If propagation hits a contradiction (an empty domain), then `g₀` had no solution to begin with. ∎

This is why a solver may freely interleave propagation and search: propagation never risks correctness, only changes how much search remains — the formal license for the "propagate-then-guess" loop of `middle.md`.

### 9.3 Worked hidden single

Suppose in box `b` the eight other cells and the surrounding rows/columns are such that, among the box's empty cells, digit `4` is a legal candidate in only one cell `x = (r, c)` — even though `x` also admits `{2, 4, 7}` as candidates. Cell `x` is *not* a naked single (it has three candidates). But `4` must appear once in box `b` (the box bijection), and `x` is the only place it can go, so `4` is forced into `x`. After placing it, `x`'s former alternatives `{2, 7}` are discarded, and the bits for `4` are set in `rowMask[r]`, `colMask[c]`, `boxMask[b]`, which may in turn make some peer a naked single — illustrating the cascade that drives propagation to a fixpoint. This is the canonical example of why hidden-single scanning catches placements naked-single scanning misses: it reasons from the digit's perspective, not the cell's.

### 9.4 Why locked candidates only prune

Locked candidates (pointing pairs/triples, box-line reduction) differ from singles: they do not *place* a digit but *eliminate* candidates. If, within box `b`, all candidate cells for digit `d` lie in a single row `r`, then `d` cannot appear in row `r` outside box `b` (it must be used inside `b`, on row `r`). This removes `d` from `r`'s cells in other boxes — a candidate elimination that may then expose a single. Soundness: any solution places `d` in box `b` on row `r`, hence not elsewhere in row `r`. These rules are sound (same implied-by-all-solutions argument) and solution-preserving, extending Proposition 9.4 to the elimination rules used by difficulty raters.

---

## 10. Symmetry and the Structure of Solutions

**The Sudoku symmetry group.** Operations mapping valid grids to valid grids: relabel the 9 digits (`9!`), permute the three rows within each band and the three bands (`(3!)³ × 3! = 6⁴`... organized as `72` per the band structure), the analogous column operations, and transposition. The group used in Theorem 7.2 has order `3,359,232`. These symmetries explain why the raw grid count (Theorem 7.1) is far larger than the essentially-different count (Theorem 7.2).

**Unavoidable sets (formal).** A set `T` of cells of a solved grid `g` is *unavoidable* if there is another valid grid `g' ≠ g` with `g'(x) = g(x)` for all `x ∉ T`. Equivalently, the values on `T` can be rearranged into a different valid completion.

**Proposition 10.1.** A clue set `P ⊆ cells` yields a proper puzzle (relative to solution `g`) only if `P` intersects every unavoidable set of `g`.

*Proof.* If some unavoidable set `T` is disjoint from `P`, then the alternate grid `g'` (which differs from `g` only on `T`) agrees with `g` on all of `P`, so `g'` is a second solution — `P` is not proper. ∎

This is the engine of the 17-clue proof (§8): proper puzzles are exactly the hitting sets of the unavoidable-set hypergraph, and the minimum hitting-set size over all grids is 17. The smallest unavoidable sets have size 4 (a "deadly pattern" / unavoidable rectangle: four cells at the corners of two rows and two columns sharing two digits), and avoiding these underlies the "unique rectangle" human-solving technique.

### 10.1 Computing the symmetry group order

The order `3,359,232` decomposes as `9! / 9! × …` — more usefully, the *grid-preserving* group (excluding digit relabeling, which is often factored separately) has order `2 × (3!)⁸ = 2 × 6⁸`... the precise figure used by Russell-Jarvis is `3,359,232 = 2 × 6^8 / ...`. The standard factorization is: row operations within and across bands give `(3!)³ × 3! = 6³ × 6 = 6⁴`, column operations another `6⁴`, and transposition a factor of `2`, yielding `6⁴ × 6⁴ × 2 = 6⁸ × 2 = 1,679,616 × 2 = 3,359,232`. Digit relabeling (`9!`) is treated as part of the full count in Theorem 7.1 and factored into the Burnside computation of Theorem 7.2. The takeaway is structural, not arithmetic: Sudoku's symmetries are exactly the operations that permute the three bands, the three stacks, the rows/columns within each, transpose, and relabel — and Burnside's lemma turns this group into the divisor that maps `6.671 × 10²¹` raw grids to `5,472,730,538` essentially-different ones.

### 10.2 Burnside's lemma, applied

Burnside's lemma states that the number of orbits (essentially-different grids) equals the average number of grids fixed by each group element:

```
#orbits = (1/|G|) · Σ_{σ ∈ G} |Fix(σ)|,
```

where `Fix(σ)` is the set of valid grids unchanged by symmetry `σ`. Most non-identity symmetries fix very few grids (a grid fixed by, say, a `90°` rotation is highly structured and rare), while the identity fixes all `6.671 × 10²¹`. Russell and Jarvis computed `|Fix(σ)|` for representatives of each conjugacy class of `G` and averaged, obtaining `5,472,730,538`. The dominance of the identity term means the essentially-different count is close to (raw count)/|G|, but the rare fixed points of non-identity symmetries make the exact figure require the full Burnside sum — a textbook orbit-counting computation at a heroic scale.

---

## 10b. Constraint Graph and Coloring View

Sudoku has an equivalent **graph-coloring** formulation. Build a graph `H` with `81` vertices (the cells) and an edge between any two cells that share a unit (are peers). Then:

**Proposition 10b.1.** Valid complete Sudoku grids correspond exactly to proper `9`-colorings of `H` (assignments of colors `{1,…,9}` to vertices with no two adjacent vertices sharing a color), restricted to those colorings where each unit uses all `9` colors.

*Proof.* A proper coloring assigns distinct colors to peers; since every two cells in a unit are peers, each unit gets `9` distinct colors among its `9` cells, i.e. a permutation of `{1,…,9}` — exactly Definition 1.3's bijection. Conversely a valid grid is a proper coloring because peers (unit-mates) hold distinct digits. ∎

`H` is `20`-regular (every cell has `20` peers, §2.1) with `810` edges. Graph `k`-coloring is NP-complete for `k ≥ 3`, which gives an alternative route to the NP-completeness of generalized Sudoku (§6): the generalized constraint graph's chromatic structure encodes the completion problem. The coloring view also explains why *partial* Sudoku (a puzzle) is a **precoloring extension** problem — extend a partial proper coloring to a full one — which is NP-complete even for fixed small color counts on general graphs, consistent with Theorem 6.1.

The chromatic number of `H` is exactly `9` (a valid grid *is* a proper 9-coloring, and `H` contains a 9-clique — any single unit's nine mutually-adjacent cells — forcing `χ(H) ≥ 9`). So Sudoku grids are the proper colorings achieving the chromatic number, the most constrained colorings possible. This clique-lower-bound argument (`χ ≥ ω`, the clique number) is a clean structural fact: the units *are* the maximum cliques, and the puzzle is to extend a partial assignment to a `χ`-coloring. Human-solving "coloring" techniques (simple coloring, multi-coloring) are literal graph-coloring inferences on a candidate sub-structure of `H`.

---

## 11. Complexity Landscape

| Problem | Setting | Complexity |
|---------|---------|-----------|
| Solve a fixed `9×9` puzzle | `n = 3` | `O(1)` (bounded); microseconds in practice |
| Decide completability | generalized `N×N` | **NP-complete** (Yato-Seta 2003) |
| Another-solution / uniqueness | generalized `N×N` | **NP-complete** (ASP-complete) |
| Exact cover (general) | any | **NP-complete** (Karp 1972, via 3D-matching) |
| Count valid `9×9` grids | `n = 3` | computed once: `6.671 × 10²¹` (Felgenhauer-Jarvis) |
| Essentially-different grids | `n = 3` | `5,472,730,538` (Russell-Jarvis, Burnside) |
| Minimum clues for proper puzzle | `n = 3` | `17` (McGuire et al. 2012, exhaustive) |

**Why backtracking is still the right practical tool.** NP-completeness is a *worst-case asymptotic* statement about the generalized family. The fixed `9×9` instance is constant-size, and real puzzles have enough structure (givens, constraints) that MRV + propagation explores few nodes. The exact-cover / DLX reformulation does not change the worst-case complexity (it is still solving an NP-complete problem) but gives an extremely efficient *constant-factor* engine — the practical sweet spot. Sibling backtracking topics (`01-n-queens`, exact-cover tilings) share this exact picture: NP-hard in general, fast with the right search and pruning at fixed sizes.

### 11.1 Where each technique sits in the landscape

| Technique | Role | Changes complexity class? | Changes constant factor? |
|-----------|------|---------------------------|--------------------------|
| Legality check (bitmask) | prune illegal placements | no | yes (O(1) checks) |
| MRV / smallest-column | search ordering | no (Prop. 5.1) | yes (huge, on hard puzzles) |
| Forward checking | early domain-emptying detection | no | yes |
| Naked/hidden singles | forced-move propagation | no (Prop. 9.4) | yes (fewer guesses) |
| GAC (`AllDifferent`) | stronger filtering | no | yes (more pruning, costlier per node) |
| Dancing Links | data structure for cover/uncover | no | yes (allocation-free O(1) undo) |
| Fast exact-cover heuristics | branching order | no | yes |

Every practical technique in this topic is a **constant-factor** improvement — none changes the worst-case complexity class, because that is pinned at NP-complete (§6) for the generalized problem and at O(1) for the fixed size. The art is entirely in the constant: the difference between a solver that explores millions of nodes and one that explores hundreds. This is the unifying complexity-theoretic statement of the whole topic.

### 11.1b A worked node-count intuition

Consider a hard 17-clue puzzle. Fixed-order backtracking might explore, say, `10⁵`–`10⁶` nodes because it repeatedly fills loosely-constrained cells and discovers contradictions deep in the tree. MRV reorders the search to always expand the tightest cell: forced cells (1 candidate) extend the path without branching, so the *effective* branching only happens at genuinely ambiguous cells, of which a proper puzzle has few. The node count drops to the order of `10²`–`10³`. The reduction factor — three to four orders of magnitude — is not from a better algorithm (it is the same backtracking) but from a better *order*, and Proposition 5.1 guarantees the answer is identical. This is the single most important quantitative fact a practitioner should internalize: ordering, not cleverness, delivers the speedup, and it is provably free of correctness risk.

### 11.2 The uniqueness-checking cost in context

Because the another-solution problem is NP-complete (§6), there is no known way to verify a puzzle is proper that avoids essentially searching for a second solution. The `limit = 2` capped counter (`middle.md`, `senior.md`) is therefore not a lazy shortcut but the *right* algorithm given the complexity: it does the minimum work that the hardness allows — find a second solution if one exists, otherwise confirm none does. A generator's per-dig uniqueness check inherits this cost, which is why the counter must be as lean as possible (bitmask MRV or DLX) and why digging is the throughput bottleneck of generation.

### 11.3 Summary of the complexity-theory picture

To collect the threads: (1) the *fixed* `9×9` puzzle is constant-size, hence trivially in `P`/`O(1)` and solved in microseconds; (2) the *generalized* `N²×N²` family is NP-complete, both for existence and for the another-solution (uniqueness) variant; (3) all the engineering techniques — bitmasks, MRV/forward-checking, propagation, GAC, Dancing Links — are constant-factor accelerators that never change the complexity class but routinely deliver 3-4 orders of magnitude on hard instances; (4) the counting and minimum-clue results (`6.671 × 10²¹` grids, `17` clues) are settled by heroic but finite computations leveraging Sudoku's symmetry and exact-cover structure. The unifying message: Sudoku is a textbook NP-complete CSP / exact-cover problem whose fixed instance is easy and whose generalized family is hard, and whose practical solution is an exercise in constant-factor engineering on top of provably-correct search.

---

## 12. Summary

- **CSP view (§2).** Sudoku is a finite-domain CSP with 27 `AllDifferent` constraints; backtracking is the generic complete solver, MRV is the most-constrained-variable heuristic, and naked/hidden singles are local-consistency enforcement.
- **Exact cover (§3).** Valid grids biject with exact covers of a `324`-element universe (cell, row-number, column-number, box-number constraints) by `729` candidate rows each covering exactly four elements (Theorem 3.1). This is the formal basis of DLX.
- **Algorithm X + DLX (§4).** Algorithm X enumerates exactly the exact covers (Theorem 4.1) by branching completely and disjointly over rows covering a chosen column; Dancing Links makes cover/uncover `O(1)` and exactly reversible (Lemma 4.2), so backtracking is allocation-free.
- **MRV (§5).** Choosing the fewest-options column/cell never affects correctness (Proposition 5.1, invariant) and minimizes immediate branching, making forced moves free and contradictions shallow — a safe-to-always-apply heuristic.
- **NP-completeness (§6).** Generalized `N×N` Sudoku and its another-solution problem are NP-complete (Yato-Seta); uniqueness checking is therefore as hard as solving, justifying the cap-at-2 search.
- **Counting (§7).** There are `6,670,903,752,021,072,936,960 ≈ 6.671 × 10²¹` valid `9×9` grids (Felgenhauer-Jarvis) and `5,472,730,538` up to symmetry (Russell-Jarvis via Burnside) — context for why solution enumeration must be capped.
- **Minimum clues (§8).** No proper puzzle has fewer than `17` clues (McGuire-Tugemann-Civario), proved by exhaustive unavoidable-set hitting-set search — itself an exact-cover computation.
- **Local consistency (§9) & symmetry (§10).** Propagation is sound (Proposition 9.3) and solution-set-preserving (Proposition 9.4); naked/hidden singles are dual views of the unit incidence; proper puzzles are hitting sets of the unavoidable-set hypergraph (Proposition 10.1), the structural core of the 17-clue theorem; Burnside's lemma over the order-`3,359,232` symmetry group yields the essentially-different count.
- **Coloring view (§10b).** Valid grids are proper `9`-colorings of the `20`-regular peer graph `H` (Proposition 10b.1); puzzles are precoloring-extension instances, giving an alternative NP-completeness route.
- **Complexity doctrine (§11).** *Every* practical technique here — bitmasks, MRV, forward checking, singles, GAC, Dancing Links — is a constant-factor improvement; none changes the complexity class. The entire engineering art is shrinking the constant from "millions of nodes" to "hundreds."

### Theorem reference table

| # | Statement | Source |
|---|-----------|--------|
| 3.1 | Valid grids ≅ exact covers of the 324-column matrix | this doc |
| 4.1 | Algorithm X enumerates exactly the exact covers | Knuth |
| 4.2 | DLX cover/uncover is O(1) and exactly reversible | Knuth |
| 5.1 | Column-choice rule does not affect the solution set | this doc |
| 6.1 | Generalized Sudoku (and its ASP) is NP-complete | Yato-Seta 2003 |
| 7.1 | `6,670,903,752,021,072,936,960` valid 9×9 grids | Felgenhauer-Jarvis 2005 |
| 7.2 | `5,472,730,538` essentially-different grids | Russell-Jarvis 2006 |
| 8.1 | No proper puzzle has < 17 clues | McGuire et al. 2012 |
| 9.3/9.4 | Single propagation is sound and solution-preserving | this doc |
| 10.1 | Proper puzzles hit every unavoidable set | this doc |
| 10b.1 | Valid grids ≅ proper 9-colorings of the peer graph | this doc |

### Open and adjacent questions

- **Exact distribution of minimum clue counts** per grid (the 17 is the global minimum, but the per-grid minimum hitting-set size varies and is not fully characterized).
- **Hardest puzzle** under various human-difficulty metrics — an active recreational-math pursuit, distinct from solver node count.
- **Generalized minimum clues** for order `n > 3` — open; the `n = 3` answer (17) required `~7` million core-hours and does not obviously generalize.
- **Counting proper puzzles** (not grids) — far harder than counting grids, because it involves the unavoidable-set hitting structure of every grid.

These sit at the boundary of the topic; the solver and complexity results above are settled, while the puzzle-space combinatorics remain partly open — a reminder that the *solving* problem is well understood while the *space of puzzles* still holds questions.

**Why the abstract framing pays off.** Reducing Sudoku to exact cover (§3) is not mere mathematical tidiness: it is what lets a *single* tested engine (Dancing Links) solve Sudoku, Latin squares, N-queens, polyomino tilings, and any other exact-cover puzzle by changing only the matrix-construction step. The abstraction localizes all problem-specific logic into "which columns does each candidate row set," and delegates the entire search to a provably-correct, allocation-free core. This separation — problem encoding vs generic search — is the professional payoff of the formal treatment, and the reason this document invests in the encoding (§3) and the search correctness (§4-§5) rather than in Sudoku-specific tricks: the encoding is what varies between problems, while the search engine, once proven correct, is reused unchanged.

### Synthesis: one problem, four equivalent views

The deepest professional takeaway is that Sudoku is *the same problem* viewed four ways, and each view contributes a tool:

| View | Object | Tool it yields |
|------|--------|----------------|
| CSP (§2) | variables + `AllDifferent` | backtracking, MRV, forward checking, GAC |
| Exact cover (§3-§4) | `324`-column 0/1 matrix | Algorithm X + Dancing Links |
| Graph coloring (§10b) | `20`-regular `81`-vertex graph | chromatic / precoloring-extension reductions |
| Hitting set (§8, §10) | unavoidable-set hypergraph | the 17-clue theorem, uniqueness reasoning |

The CSP view powers everyday solving; the exact-cover view powers the fastest engine and all-solutions enumeration; the coloring view gives one clean NP-completeness route; the hitting-set view governs which puzzles are proper and how few clues are possible. All four are polynomial-time inter-reducible — they describe one underlying structure — which is why a single piece of complexity theory (NP-completeness of the generalized problem) and a single engineering doctrine (keep the constant small via pruning and ordering) span the entire topic.

### Foundational References

- D. Knuth, *Dancing Links* (2000) — Algorithm X and DLX.
- T. Yato & T. Seta (2003) — NP-completeness of Sudoku and the another-solution problem.
- B. Felgenhauer & F. Jarvis (2005) — enumerating the `6.671 × 10²¹` valid grids.
- E. Russell & F. Jarvis (2006) — essentially-different grids via Burnside.
- G. McGuire, B. Tugemann, G. Civario (2012) — *There is no 16-clue Sudoku* (minimum-clue theorem).
- C. Colbourn (1984) — NP-completeness of Latin-square completion (the reduction source).
- J.-C. Régin (1994) — filtering algorithm for `AllDifferent` (GAC).
- R. M. Karp (1972) — *Reducibility Among Combinatorial Problems* (exact cover / 3D-matching NP-completeness).
- P. Norvig — "Solving Every Sudoku Puzzle" (constraint propagation + search, the practical essay).
- S. Russell & P. Norvig, *Artificial Intelligence: A Modern Approach* — CSP, MRV, forward checking, AC-3, the consistency hierarchy.

Sibling topics: `01-n-queens` (also an exact-cover instance solvable by the same DLX engine), and the broader `16-backtracking` / constraint-satisfaction literature. The throughline across all of them: model the constraints precisely, choose a provably-correct search, and pour the engineering into the constant factor via ordering and propagation.

The final word: Sudoku is small enough to solve by hand yet rich enough to host the entire vocabulary of combinatorial search — CSP, exact cover, graph coloring, NP-completeness, symmetry counting, and minimum-hitting-set theory — which is exactly why it is the canonical teaching vehicle for backtracking and constraint propagation.
```