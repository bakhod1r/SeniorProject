# The 15-Puzzle — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. State-Space Size and the Permutation Group
3. The Solvability Parity Theorem (with Proof)
4. Admissibility and Consistency of Heuristics
5. Manhattan Distance: Admissibility and Consistency Proofs
6. Linear Conflict: Admissibility Proof
7. Pattern Database Admissibility and Additivity
8. IDA* Optimality and Completeness
9. IDA* Node-Count Analysis
10. NP-Hardness of the Generalized (N²−1)-Puzzle
11. Summary

---

## 1. Formal Definitions

Consider the `(s × s)` sliding-tile puzzle with `N = s² − 1` numbered tiles and one blank. The cell set is `C = {0, 1, …, s²−1}`, identified with positions `(r, c)` via `cell = r·s + c`.

**Definition 1.1 (State).** A **state** is a bijection `σ : C → {0, 1, …, N}` assigning to each cell either a tile `t ∈ {1, …, N}` or the blank `0`. Equivalently, a state is a permutation of `{0, …, N}` placed on the grid. There are `(N+1)! = (s²)!` total arrangements.

**Definition 1.2 (Goal).** The **goal** state `g` has `g(cell) = cell + 1` for `cell < N` and `g(N) = 0` (blank in the bottom-right). Other goal conventions (blank top-left) only relabel the analysis.

**Definition 1.3 (Move).** A **move** transposes the blank with an orthogonally adjacent tile: if the blank is at cell `b` and `b'` is a grid-neighbor of `b`, the move produces the state with `σ(b), σ(b')` swapped. Each move is its own inverse, and the move graph is undirected.

**Definition 1.4 (Move graph).** The **state space** is the undirected graph `Γ = (S, M)` where `S` is the set of states and `{σ, σ'} ∈ M` iff a single move relates them. Solving from `σ₀` is finding a shortest path `σ₀ ⇝ g` in `Γ`.

**Definition 1.5 (Solution length).** The optimal solution length `C*(σ₀)` is the graph distance `d_Γ(σ₀, g)`. The **diameter** of the solvable component is the maximum `C*` over all solvable `σ₀`.

**Notation.** Throughout, `s` is the side length, `N = s²−1` the tile count, `σ` a state, `h` a heuristic, `g(σ)` the cost from the start, `f = g + h`, and `C*` the optimal length. "Walk" in `Γ` permits revisits; a shortest path does not. The blank is `0` and is never counted as a tile in any heuristic.

### 1.1 The Implicit Graph Model

We never materialize `Γ`. Instead the search is defined by three procedures over an *implicit* graph:

```
goal_test(σ)      -> bool          # σ == g ?
successors(σ)     -> list of σ'    # apply each legal move
cost(σ, σ')       -> 1             # unit edge weight
```

This implicit-graph view is what makes the `10^13`-vertex 15-puzzle tractable: `Γ` exists only conceptually; at any instant the algorithm holds a single state and generates neighbors on demand. The heuristic `h` is the only external knowledge injected, and admissibility (Definition 4.1) is the single property the optimality proofs (Section 8) require of it.

### 1.2 Move Reversibility and the Undirected Structure

Each move is an involution: applying the same blank-tile swap twice returns the original state. Therefore `Γ` is **undirected** and `d_Γ` is a genuine metric (symmetric, triangle inequality). Symmetry has a practical payoff: a PDB built by *backward* BFS from the goal (Section 7, and `senior.md` §4) measures the same distances as forward search, because forward and backward distances coincide on an undirected graph. The triangle inequality on `d_Γ` is also exactly the consistency condition (Definition 4.2) that the true distance `h*(σ) = d_Γ(σ, g)` trivially satisfies — making `h*` the perfect (but uncomputable) consistent heuristic that all practical heuristics approximate from below.

---

## 2. State-Space Size and the Permutation Group

**Theorem 2.1 (Reachable states).** The reachable states from the goal form exactly **half** of all arrangements: `(s²)! / 2`.

**Proof sketch.** Identify each state with a permutation `π ∈ Sym(s²)` of the `s²` symbols (tiles plus blank) read in cell order. A single move is a transposition of the blank with an adjacent symbol, i.e. multiplication by a transposition — an **odd** permutation. Define the invariant `χ(σ) = sgn(π) · (−1)^{taxicab distance of blank to its goal cell}`. A move multiplies `sgn(π)` by `−1` (one transposition) and changes the blank's taxicab distance by exactly `±1` (also flipping `(−1)^{dist}`), so the product `χ` is **unchanged** by every move. Hence `χ` is a conserved quantity taking two values; only states sharing the goal's `χ` are reachable. A counting/connectivity argument (Wilson's theorem on the puzzle graph) shows the reachable set is exactly one `χ`-class, of size `(s²)!/2`. ∎

**Corollary 2.2.** For `s = 3` (8-puzzle): `9!/2 = 181{,}440` reachable states. For `s = 4` (15-puzzle): `16!/2 = 10{,}461{,}394{,}944{,}000 ≈ 1.05 × 10^{13}` reachable states.

**Remark (diameters, known by exhaustive search).** The 8-puzzle's hardest solvable instance needs **31** moves; the 15-puzzle's diameter is **80** moves; the 24-puzzle's is conjectured around 152–208 (only bounds are proven). These were established by complete BFS (8-puzzle) and by optimal IDA* with PDBs (15-puzzle).

### 2.1 State-Space Growth Across Sizes

The reachable-state count `(s²)!/2` grows hyper-exponentially:

```
s   tiles N   total (s²)!        reachable (s²)!/2
2   3         24                 12
3   8         362,880            181,440
4   15        ≈ 2.09 × 10^13     ≈ 1.05 × 10^13
5   24        ≈ 6.20 × 10^23     ≈ 3.10 × 10^23
```

The jump from `s = 3` to `s = 4` is the watershed: 181,440 states fit trivially in RAM (BFS works), but `10^13` does not (BFS impossible, IDA* required). The `s = 5` count of `3 × 10^23` is far beyond any frontier; even with strong PDBs, optimal 24-puzzle solving of the hardest instances is at the edge of feasibility. This table is the quantitative motivation for the entire memory-light-search agenda.

### 2.2 Why the Move Graph Is Connected on Its Half

**Proposition 2.3 (Wilson, 1974).** For `s ≥ 2` (excluding one small exceptional puzzle graph, the `θ_0` graph), the sliding-tile move graph restricted to one parity class is connected. Hence *every* solvable board can reach the goal, not merely "shares the invariant."

This is what justifies treating solvability as exactly the parity condition: there is no second obstruction. The invariant `χ` is both necessary (Theorem 2.1) and, by connectivity, sufficient. Without Wilson's connectivity result we could only conclude the parity test is *necessary*; with it, the test is a complete characterization.

### 2.3 The Blank's Role in the Invariant

It is worth isolating *why* the blank's row enters the even-width invariant but not the odd-width one. A single move is a transposition (the blank with one tile), always an odd permutation, so `sgn(π)` flips every move. For the *tile* permutation (blank omitted), a horizontal move is the identity (0 transpositions of tiles) while a vertical move is a cyclic shift of `s − 1` tiles, i.e. `s − 1` transpositions:

```
parity of tile-permutation change per move:
  horizontal move:  0          (even, always)
  vertical move:    s - 1      (odd iff s even)
```

For odd `s`, vertical moves are even permutations of tiles, so the tile-permutation parity (= `inv mod 2`) is conserved alone. For even `s`, vertical moves are odd, flipping `inv mod 2`, but each such move also changes the blank's row by 1; tying the two flips together gives the conserved `inv + blankRow`. This is the cleanest way to see the asymmetry: it is entirely about the parity of `s − 1`.

---

## 3. The Solvability Parity Theorem (with Proof)

Read a state as a sequence by listing tiles in cell order, **omitting the blank**. Let `inv(σ)` be the number of inversions in this sequence (pairs out of order), and let `bottomRow(σ)` be the blank's row counted from the bottom, 1-based.

**Theorem 3.1 (Solvability).**
- **Odd side `s` (e.g. 3, 5):** `σ` is solvable iff `inv(σ)` is **even**.
- **Even side `s` (e.g. 4):** `σ` is solvable iff `inv(σ) + bottomRow(σ)` is **even**.

**Proof.** We show the stated quantity is invariant under every move and equals the goal's value (which is "even"), so a state is solvable iff it matches.

*Horizontal moves.* A left/right move swaps the blank with a horizontal neighbor. In the blank-omitted reading sequence, the relative order of every pair of *tiles* is unchanged: the blank merely trades cells with one tile, and since the blank is omitted, no two tiles change their relative reading order. Therefore `inv` is unchanged (`Δinv = 0`), and the blank stays in the same row, so `bottomRow` is unchanged. Both candidate invariants are preserved.

*Vertical moves.* A vertical move swaps the blank with the tile `s` cells away in the reading order. In the blank-omitted sequence, this is equivalent to moving one tile across the `s − 1` tiles that lie between the blank's old and new positions in reading order — a cyclic shift past `s − 1` tiles, which changes the inversion count by an **odd** amount when `s − 1` is odd and by an **even** amount when `s − 1` is even. Precisely, jumping a tile over `s − 1` others flips the order of it against each, so `Δinv ≡ s − 1 (mod 2)`. Simultaneously the blank changes row by 1, so `Δ bottomRow = ±1` (odd).

  - **Odd `s`:** `s − 1` is even, so `Δinv` is even ⇒ `inv mod 2` is invariant under vertical moves (and horizontal). Thus `inv mod 2` is a global invariant. The goal has `inv = 0` (even), so solvable ⟺ `inv` even.
  - **Even `s`:** `s − 1` is odd, so `Δinv` is odd under a vertical move, and `Δ bottomRow` is also odd, so `Δ(inv + bottomRow)` is **even** ⇒ `(inv + bottomRow) mod 2` is invariant. (Horizontal moves change neither.) The goal has `inv = 0` and the blank in the bottom row, `bottomRow = 1`, so the goal's invariant is `0 + 1 = 1` (odd)... 

  We must match the goal's class. With the goal value `inv=0, bottomRow=1` the conserved quantity `inv + bottomRow ≡ 1 (mod 2)`. Restating in the conventional "even" form: a state is solvable iff `inv + bottomRow` has the **same parity as the goal**, i.e. is **odd** under this exact convention, equivalently `inv` is even precisely when the blank is on an odd row from the bottom. The common textbook phrasing "`inv + rowFromBottom` even" arises when `bottomRow` is measured from a 0-based bottom or the blank's distance from the bottom row; the substantive content is the *conserved parity of `inv + blankRow`*, independent of indexing convention. ∎

**Practical statement (0-based blank distance from bottom).** Let `d_b = (s − 1) − rowFromTop(blank)` be the blank's distance from the bottom row. Then for even `s`, solvable iff `inv + d_b` is **even**; for odd `s`, solvable iff `inv` is even. This is the form used in the code in the other files. The invariance argument is the proof above; only the constant offset depends on how you index the blank's row.

**Corollary 3.2.** Exactly half of all arrangements are solvable, matching Theorem 2.1: the invariant partitions the `(s²)!` arrangements into two equal `parity`-classes, and only the goal's class is reachable.

### 3.1 Worked Parity Example (8-puzzle, odd width)

Take the board:

```
 8  1  3
 4  0  2
 7  6  5
```

Reading order, blank omitted: `8, 1, 3, 4, 2, 7, 6, 5`. Count inversions (pairs `a` before `b` with `a > b`):

```
8 > 1,3,4,2,7,6,5   -> 7
1 > (none)          -> 0
3 > 2               -> 1
4 > 2               -> 1
2 > (none after)    -> 0
7 > 6,5             -> 2
6 > 5               -> 1
total inversions    -> 12  (even)
```

Width is 3 (odd), so solvable iff inversions even. `12` is even, so this board **is solvable**. A direct BFS confirms an optimal solution exists. Flipping any single adjacent pair (e.g. swapping the `5` and `6`) would make the count odd and the board unsolvable — exactly the "half are unsolvable" partition.

### 3.2 Worked Parity Example (15-puzzle, even width)

Take the 15-puzzle board:

```
  1  2  3  4
  5  6  7  8
  9 10 11 12
 13 15 14  0
```

Reading order, blank omitted, is the sorted sequence except `… 13, 15, 14`. The only inversion is `(15, 14)`, so `inv = 1`. The blank sits at index 15, i.e. `rowFromTop = 3` (0-based), so the distance from the bottom is `(s − 1) − rowFromTop = 3 − 3 = 0`. Then `inv + d_b = 1 + 0 = 1`, which is **odd**, so this board is **unsolvable** — the classic "swap the last two tiles" trick that produces the famous unsolvable position. No sequence of slides can fix a single transposition on an even-width board without also moving the blank an odd number of rows, which is exactly what the invariant forbids.

### 3.3 The Invariant as a Group-Theoretic Statement

The moves generate a subgroup of `Sym(s²)`. Theorem 3.1 says that subgroup is contained in (in fact equals, by Wilson's theorem for `s ≥ 2` excluding a small exceptional graph) the kernel of the homomorphism `χ : Sym(s²) → {±1}` defined by the conserved parity. Solvability is precisely membership in the coset of the start relative to the goal, and the two cosets are the two equal halves of Corollary 3.2. This reframes the elementary inversion count as the statement "the reachable group is the even part of the relevant signed permutation structure."

---

## 4. Admissibility and Consistency of Heuristics

**Definition 4.1 (Admissible).** A heuristic `h : S → ℝ≥0` is **admissible** if `h(σ) ≤ d_Γ(σ, g)` for all `σ` — it never overestimates the true remaining cost.

**Definition 4.2 (Consistent / monotone).** `h` is **consistent** if `h(g) = 0` and `h(σ) ≤ c(σ, σ') + h(σ')` for every neighbor `σ'`, where `c(σ, σ') = 1` is the move cost.

**Proposition 4.3.** Consistency implies admissibility.

**Proof.** Induct on `d = d_Γ(σ, g)`. Base `d = 0`: `σ = g`, `h(g) = 0 = d`. Step: let `σ'` be the first state on a shortest path, so `d_Γ(σ', g) = d − 1`; by consistency `h(σ) ≤ 1 + h(σ') ≤ 1 + (d − 1) = d` using the inductive hypothesis on `σ'`. ∎

Admissibility is what guarantees IDA*/A* return optimal solutions (Section 8). Consistency additionally guarantees A* never re-opens closed nodes and that `f` is non-decreasing along any path — useful for the `f`-bound reasoning in IDA*.

### 4.1 The f-Monotonicity Consequence

**Proposition 4.4.** If `h` is consistent, then along any path `σ_0, σ_1, …` the values `f(σ_i) = g(σ_i) + h(σ_i)` are non-decreasing.

**Proof.** `f(σ_{i+1}) = g(σ_i) + c(σ_i, σ_{i+1}) + h(σ_{i+1}) ≥ g(σ_i) + h(σ_i) = f(σ_i)`, using consistency `h(σ_i) ≤ c(σ_i, σ_{i+1}) + h(σ_{i+1})`. ∎

For IDA* this means: once a node has `f > threshold`, all its descendants also have `f > threshold`, so pruning a node soundly prunes its whole subtree without further checks. With an *inadmissible-but-still-monotone* surrogate this still holds, but optimality (Section 8) requires admissibility, not merely monotonicity.

### 4.2 Admissible but Inconsistent Heuristics

Admissibility does *not* imply consistency. One can construct admissible heuristics where `f` decreases along an edge; such heuristics still yield optimal solutions but may force A* to re-open closed nodes (more work). Manhattan and PDB heuristics for the sliding puzzle are consistent, so this pathology does not arise here — a convenient property that keeps IDA*'s subtree-pruning sound and A*'s closed set stable. The takeaway: for the puzzle we get the stronger consistency for free, but the *optimality* guarantee rests only on the weaker admissibility.

---

## 5. Manhattan Distance: Admissibility and Consistency Proofs

For a state `σ`, define `MD(σ) = Σ_{t=1}^{N} ( |r_t − r_t^*| + |c_t − c_t^*| )`, where `(r_t, c_t)` is tile `t`'s current cell and `(r_t^*, c_t^*)` its goal cell.

**Theorem 5.1 (Admissibility of Manhattan).** `MD(σ) ≤ d_Γ(σ, g)`.

**Proof.** Each move slides exactly one tile to an orthogonally adjacent cell, changing that tile's Manhattan distance by exactly `±1` and leaving all other tiles' distances unchanged (the blank contributes nothing). Hence one move decreases `MD` by **at most 1**: `MD(σ) − MD(σ') ≤ 1` for any neighbor. Along an optimal solution of length `d_Γ(σ, g)`, `MD` must drop from `MD(σ)` to `MD(g) = 0`, decreasing by at most 1 per move, so the number of moves is at least `MD(σ)`. Thus `MD(σ) ≤ d_Γ(σ, g)`. ∎

**Theorem 5.2 (Consistency of Manhattan).** `MD(σ) ≤ 1 + MD(σ')` for every neighbor `σ'`.

**Proof.** As argued, a single move changes `MD` by exactly `±1`, so `|MD(σ) − MD(σ')| = 1 ≤ 1`. In particular `MD(σ) ≤ 1 + MD(σ')`. And `MD(g) = 0`. Hence Manhattan is consistent. ∎

**Corollary 5.3.** `MD` dominates the Hamming heuristic `H` (`H(σ) ≤ MD(σ)`), since each misplaced tile contributes `≥ 1` to both, and `MD` adds the *distance* not just an indicator. A dominating admissible heuristic expands no more nodes in A*/IDA* (the heuristic-comparison theorem), so Manhattan is never worse than Hamming.

### 5.1 The Heuristic-Comparison Theorem

**Theorem 5.4.** Let `h_1, h_2` be admissible and consistent with `h_1(σ) ≤ h_2(σ)` for all `σ` (`h_2` *dominates* `h_1`). Then A* using `h_2` expands a subset of the nodes A* using `h_1` expands (ignoring tie-breaking).

**Proof idea.** A* with a consistent heuristic expands exactly the nodes with `f(σ) = g(σ) + h(σ) < C*` (plus some with `f = C*`). Since `g` is fixed by the graph, a larger `h` makes `f` larger, so fewer nodes satisfy `f < C*`. Thus the higher heuristic expands no extra nodes. The same monotonicity drives IDA*'s effective branching factor down. ∎

This is the formal reason the heuristic ladder (Hamming ⊑ Manhattan ⊑ Manhattan+LC ⊑ PDB) yields monotonically fewer expansions: each rung dominates the one below.

### 5.2 Why the Blank Is Excluded

A subtle but important point: the blank is *not* a tile to be placed, and including its Manhattan distance would make the heuristic inadmissible. Consider a state one move from the goal where only the blank is off its goal cell: the true distance is 1, but the blank's own Manhattan distance plus a misplaced tile's distance could exceed 1, overestimating. The clean statement of admissibility (Theorem 5.1) relies on each *tile* move reducing the tile-sum by at most 1; the blank's motion is the *mechanism* of moves, not a quantity to minimize, so it is correctly excluded from the sum.

---

## 6. Linear Conflict: Admissibility Proof

**Definition 6.1 (Linear conflict).** Two tiles `t_a, t_b` are in **linear conflict** if (i) both have their goal cells in the same line `L` (a row or column), (ii) both currently occupy cells in `L`, and (iii) their current order along `L` is the reverse of their goal order. Let `LC(σ)` be the minimum number of tiles that must be removed from their goal lines so that no conflict remains, summed over all rows and columns; the linear-conflict heuristic is `LC^+(σ) = MD(σ) + 2·LC(σ)`.

**Theorem 6.2 (Admissibility of linear conflict).** `LC^+(σ) ≤ d_Γ(σ, g)`.

**Proof.** Manhattan already counts the within-line travel of each tile. Consider a single goal line `L` (say a row) and the tiles whose goal cells lie in `L`. If two such tiles `t_a, t_b` are both in `L` but reversed, at least one of them must **leave** line `L` and re-enter to let them pass, because two tiles cannot swap order while both remaining inside a single row using only moves that keep them in the row (a tile can only move within the row by horizontal slides, which preserve relative order). Each such departure-and-return costs **2 moves** (one to leave, one to return) that Manhattan does **not** count — Manhattan only counts the net within-line displacement, which is the same whether or not the detour happened. The quantity `LC(σ)` is defined as the minimum number of tiles forced to leave their lines (an exact minimum vertex-cover-style count over conflict pairs, capped so no move is double-charged across rows and columns), so `2·LC(σ)` is a valid additional lower bound disjoint from Manhattan's count: row detours are vertical moves, column detours are horizontal moves, and Manhattan's per-tile count is unaffected by these extra detour moves. Therefore `MD(σ) + 2·LC(σ) ≤ d_Γ(σ, g)`. ∎

**Remark (why disjointness holds).** A move is either horizontal or vertical. Manhattan's decrease is charged to the tile that moved. A linear-conflict detour move for a *row* conflict is necessarily a *vertical* move (leaving/entering the row), and for a *column* conflict a *horizontal* move; these detour moves are exactly the ones Manhattan does **not** credit toward progress (they increase or hold a tile's Manhattan distance), so adding `2` per resolved conflict cannot exceed the true count. The careful "minimum tiles to remove" definition prevents counting a single tile's detour twice across overlapping conflict pairs.

### 6.1 Worked Linear-Conflict Example

Consider a 3-wide goal row that should read `1 2 3`, but currently holds:

```
 3  2  1     (all three belong in this row; goal order is 1 2 3)
```

Manhattan for these three tiles: tile `1` is 2 cells from its home (col 0), tile `3` is 2 cells from home (col 2), tile `2` is home. So Manhattan contribution `= 2 + 0 + 2 = 4`. But Manhattan assumes each can slide straight home — impossible here, because `1` and `3` must pass each other and they are in the same row. The conflict pairs are `(3,1)` reversed and `(2,1)`, `(3,2)` reversed.

The minimum number of tiles that must leave the row to resolve all conflicts is 1 (move one of them out, let the others sort, bring it back), costing `2` extra moves. So linear conflict adds `+2`, giving `4 + 2 = 6` for this row — a strictly better lower bound than Manhattan's `4`. A direct count confirms reversing three tiles in a row genuinely needs those two extra vertical moves, so `+2` is admissible and tight here.

### 6.2 The Minimum-Removal Count Is a Vertex Cover

Formally, build a conflict graph on the tiles of a line: an edge between each reversed pair. The number of tiles that must leave the line is the **minimum vertex cover** of this conflict graph (remove a minimum set of tiles so no conflicting pair remains entirely inside the line). For a single line this is computed greedily/exactly in `O(s²)`. Summing `2 ×` the cover over all `2s` lines (rows and columns) gives the linear-conflict bonus. Capping at the cover (not the raw pair count) is essential: counting `2` per *pair* would overestimate when three tiles mutually conflict (one removal fixes all three pairs), violating admissibility.

---

## 7. Pattern Database Admissibility and Additivity

Let `P ⊆ {1, …, N}` be a tile pattern. The **abstract** puzzle `Φ_P` keeps tile identities only for `t ∈ P` and the blank; all other tiles are an indistinguishable "blank-like" filler that may be moved freely. Define `PDB_P(σ)` = the exact minimum number of moves to bring the `P`-tiles to their goal cells in `Φ_P`.

**Theorem 7.1 (PDB admissibility).** `PDB_P(σ) ≤ d_Γ(σ, g)`.

**Proof.** Any optimal real solution of `σ`, projected onto `Φ_P` (forgetting the identities of non-`P` tiles), is a sequence of legal abstract moves that solves the abstract puzzle. Its length equals the real solution length `d_Γ(σ, g)` (every real move is an abstract move). Since `PDB_P(σ)` is the *minimum* abstract solution length, `PDB_P(σ) ≤ d_Γ(σ, g)`. ∎

**Definition 7.2 (Additive accounting).** Build `PDB_P` counting **only moves that move a tile in `P`** (moves of the blank or of non-`P` tiles cost 0). Call this `aPDB_P`.

**Theorem 7.3 (Additivity).** Let `P_1, …, P_m` be a partition of `{1, …, N}` into disjoint groups, each `aPDB` built with own-group accounting. Then `H(σ) = Σ_i aPDB_{P_i}(σ)` is admissible: `H(σ) ≤ d_Γ(σ, g)`.

**Proof.** Fix an optimal real solution `σ ⇝ g` of length `C* = d_Γ(σ, g)`. Each real move moves exactly **one** tile; that tile lies in exactly **one** group `P_i` (the partition is disjoint). For group `P_i`, the projection of the real solution onto `Φ_{P_i}` is a legal abstract solution whose **own-group cost** equals the number of real moves that moved a `P_i`-tile; call it `m_i`. By minimality `aPDB_{P_i}(σ) ≤ m_i`. Summing: `Σ_i aPDB_{P_i}(σ) ≤ Σ_i m_i = C*`, because every one of the `C*` real moves is counted in exactly one `m_i` (one move moves one tile, in one group). Hence `H(σ) ≤ C*`. ∎

**Corollary 7.4 (Why sum, not max).** For *non-additive* (overlapping or full-cost) PDBs, the same real move can be charged in two groups, so summing may overcount and violate admissibility; those must be combined with `max`. The additive accounting (own-group moves only) is precisely the condition that licenses the much stronger `Σ`. This is the theoretical heart of disjoint additive PDBs (Korf & Felner).

**Corollary 7.5 (Reflection).** If `ρ` is the diagonal automorphism of the grid (which is a graph automorphism of `Γ` fixing `g`), then `H(ρ(σ))` is also admissible, and `max(H(σ), H(ρ(σ)))` is admissible and `≥ H(σ)`. (Automorphisms preserve distances, so the reflected bound is valid.)

### 7.1 Worked Additivity Example

Consider a tiny `2 × 2` "3-puzzle" (tiles 1,2,3 + blank) with two groups `P_1 = {1}`, `P_2 = {2, 3}`. Suppose an optimal real solution makes 5 moves: 2 of them move tile 1, 2 move tile 2, 1 moves tile 3.

- `aPDB_{P_1}` counts only tile-1 moves along the projected solution: 2.
- `aPDB_{P_2}` counts only tile-2 and tile-3 moves: `2 + 1 = 3`.
- Sum: `2 + 3 = 5 = C*`.

The sum is tight here because every move moved a tracked tile. If instead one of the 5 moves only repositioned the *blank past a don't-care cell* in both abstractions, it would be charged 0 in each group, and the sum would be `≤ C*` — still admissible. The disjointness guarantees no move is charged twice; the own-group accounting guarantees no move is charged in a group whose tile it did not move.

### 7.2 Failure of Naive (Non-Additive) Summation

Now build the *same* two databases but with **full-cost** accounting (every move costs 1 in every group's abstraction). Then a move of tile 1 costs 1 in `P_1`'s database *and* 1 in `P_2`'s (because in `P_2`'s abstraction, moving tile 1 is moving a don't-care, but full-cost charges it anyway). Summing now double-counts that move, and the heuristic can exceed `C*`, becoming inadmissible. This is precisely why non-additive databases must be combined with `max`, not `+` — and why the own-group accounting of Definition 7.2 is the load-bearing condition for additivity.

### 7.3 Optimal Partition Choice

Among disjoint partitions, larger groups capture more interaction (stronger `h`) but cost exponentially more memory. The choice is a constrained optimization: maximize expected heuristic value subject to a total-memory budget `Σ_i size(P_i) ≤ B`. Empirically (Korf & Felner) the 7-8 split dominates 5-5-5 and 6-6-3 on the 15-puzzle because two large groups capture deep interactions; the 6-6-6-6 split is the practical choice for the 24-puzzle. There is no closed-form optimum — partition selection is a heuristic meta-problem solved by experiment.

### 7.4 The Perfect-Hash Ranking (Lehmer Code)

To store a PDB as a flat array, the positions of the `m` group tiles must map bijectively to `[0, P)` where `P = s²·(s²−1)·…·(s²−m+1)` is the number of ordered placements. The standard scheme is a partial-permutation rank via the factorial number system:

```
rank(positions[0..m-1], totalCells):
    # positions are the cells holding tiles 1..m of the group, in order
    used = boolean array of length totalCells
    r = 0
    for k in 0 .. m-1:
        # count how many smaller cell indices are still unused
        smaller = number of unused cells with index < positions[k]
        slots_left = totalCells - k          # cells available at this step
        r = r * slots_left + smaller
        mark positions[k] used
    return r
```

The inverse `unrank(r)` recovers the positions, and a round-trip test `unrank(rank(p)) == p` verifies the bijection — a mandatory unit test, since a ranking bug silently corrupts the database (Section corresponds to Failure Mode 10.3 in `senior.md`).

**Lemma 7.6 (Bijectivity).** `rank` is a bijection from ordered `m`-placements on `s²` cells to `{0, …, P − 1}`.

**Proof.** At step `k`, `smaller ∈ {0, …, slots_left − 1}` is a valid digit in a mixed-radix system with radices `slots_left = s², s²−1, …, s²−m+1`. The map from digit tuples to integers in such a system is a bijection onto `{0, …, ∏ radix − 1} = {0, …, P − 1}`, and each placement yields a unique digit tuple (the count of unused smaller cells is determined by the placement). Hence `rank` is bijective. ∎

This is why the table size is *exactly* `P` with no wasted slots — a key property for the memory budget of Section 5 in `senior.md`.

---

## 8. IDA* Optimality and Completeness

**Algorithm (recap).**
```
IDA*(σ₀):
  bound = h(σ₀)
  loop:
    t = DFS(σ₀, g=0, bound)
    if t == FOUND: return solution
    if t == ∞: return "no solution"
    bound = t                      # smallest f that exceeded the previous bound
DFS(σ, g, bound):
  f = g + h(σ)
  if f > bound: return f
  if σ == g: return FOUND
  return min over successors σ' of DFS(σ', g+1, bound)   # FOUND short-circuits
```

**Theorem 8.1 (Optimality).** If `h` is admissible, the first solution IDA* returns has length `C* = d_Γ(σ₀, g)`.

**Proof.** *No too-long solution is returned.* IDA*'s bounds form a strictly increasing sequence `b_0 = h(σ₀) < b_1 < b_2 < …`, each `b_{i+1}` being the minimum `f`-value strictly exceeding `b_i` encountered in iteration `i`. When DFS reaches a goal in iteration `i`, it does so along a path all of whose nodes have `f ≤ b_i`; at the goal `f = g + h(g) = g + 0 = g`, so the returned length is `g ≤ b_i`.

*The first solution is optimal.* Because `h` is admissible, along an optimal path every node `σ` has `f(σ) = g(σ) + h(σ) ≤ g(σ) + d_Γ(σ, g) = C*`. So the optimal path is *never pruned* once `bound ≥ C*`. Now consider the first iteration with `bound ≥ C*`. Two cases: if a goal is found, its length is `≤ bound`; but it is also `≥ C*` (no path is shorter than the optimum), and we must show it equals `C*`. Since bounds increase to exactly the next achievable `f`, the first time `bound` reaches a value `≥ C*` it equals `C*` (the optimal path's nodes have `f ≤ C*`, and `C*` itself is an achievable `f` at the goal, so it is among the candidate next-bounds; no bound strictly between the previous and `C*` is skipped because `b_{i+1}` is the *minimum* overshoot). At `bound = C*` the DFS explores the optimal path fully (never pruned) and reaches the goal at depth `C*`, returning `C*`. Any solution found cannot be shorter than `C*` by definition. Hence the returned length is exactly `C*`. ∎

**Theorem 8.2 (Completeness).** On a finite graph (or a graph with a finite solution and bounded local branching), IDA* with admissible `h` terminates and finds a solution iff one exists.

**Proof.** Each iteration is a finite DFS bounded by `bound` (only finitely many states have `f ≤ bound` since costs are positive integers and branching is finite). If a solution exists, its length `C*` is finite and the bound increases by at least 1 each failed iteration (bounds are integers here), so after finitely many iterations `bound ≥ C*` and the goal is found. If none exists, on a finite reachable component the DFS eventually returns `∞` (no node exceeds the bound), and IDA* reports failure. ∎

### 8.1 Worked IDA* Iteration Trace

Take the 8-puzzle:

```
 1  2  3
 4  5  6
 0  7  8
```

The blank is at index 6 (row 2, col 0). Misplaced tiles: `7` (goal index 6, at index 7) and `8` (goal index 7, at index 8); each is Manhattan distance 1, so `h(start) = 2`. The true optimal length turns out to be 2.

```
Iteration 1: threshold = h(start) = 2
  node start:        g=0, h=2, f=2 ≤ 2  -> expand
    move tile 7 left (blank 6<->7):
      board 1 2 3 / 4 5 6 / 7 0 8        g=1, h=1, f=2 ≤ 2 -> expand
        move tile 8 left (blank 7<->8):
          board 1 2 3 / 4 5 6 / 7 8 0    g=2, h=0, f=2 -> GOAL (found)
  -> solution length 2, optimal. Done in one iteration.
```

Because `h(start)` already equaled `C*`, the first threshold sufficed. For a harder board where `h(start) < C*`, iteration 1 would prune (recording the minimum overshoot), and the loop would raise the threshold until it equaled `C*`.

### 8.2 A Pruning-and-Raise Trace

Now suppose a board with `h(start) = 4` but `C* = 6`. The schematic of the outer loop:

```
threshold = 4:
  DFS explores; every leaf prunes with f ∈ {5, 6, 7, ...}
  smallest pruned f recorded = 5
  no goal at depth ≤ threshold with f ≤ 4  -> raise
threshold = 5:
  DFS explores deeper; smallest pruned f recorded = 6
  no goal  -> raise
threshold = 6:
  DFS reaches the goal at depth 6, f = 6 ≤ 6  -> FOUND, length 6 (optimal)
```

The three thresholds `4 → 5 → 6` are exactly the achievable `f`-values in ascending order; no value is skipped (the loop always jumps to the *minimum* overshoot), which is what makes the first found solution optimal (Theorem 8.1).

---

## 9. IDA* Node-Count Analysis

**Setup.** Let `n_i` be the number of nodes expanded in iteration `i` (bound `b_i`), and let the search tree have effective branching factor `b_eff > 1` so that `n_i ≈ b_eff^{b_i}` (node count grows geometrically with the bound for a branching tree).

**Theorem 9.1 (Overhead is a constant factor).** The total work `Σ_{i=0}^{I} n_i` (where `b_I = C*`) satisfies `Σ_i n_i ≤ n_I · b_eff / (b_eff − 1) = O(n_I)`.

**Proof.** With integer bounds increasing by `≥ 1`, `n_i ≤ n_I · b_eff^{-(I − i)}`. Summing the geometric series, `Σ_{i=0}^{I} n_i ≤ n_I Σ_{j≥0} b_eff^{-j} = n_I · b_eff/(b_eff − 1)`. For `b_eff` bounded away from 1 (the 15-puzzle's `b_eff ≈ 2.13` after reversal pruning, and lower with strong heuristics), this is a small constant multiple of the last iteration. ∎

**Corollary 9.2 (When the analysis breaks).** If the tree grows only **polynomially** with the bound (e.g. a nearly-linear graph, `b_eff → 1`), the geometric sum no longer telescopes to `O(n_I)` and IDA* can do `Θ(I · n_I)` work — quadratic blow-up. This is the known weakness of iterative deepening on low-branching graphs; the sliding-tile puzzle is safely in the geometric regime.

**Heuristic strength and `b_eff`.** A more accurate admissible heuristic raises every node's `f`, pushing more subtrees over the bound and lowering `b_eff`. The relationship `nodes ≈ b_eff^{C*}` means a heuristic that lowers `b_eff` even slightly yields exponential savings — the quantitative reason PDBs (which dramatically tighten `h`) make hard instances tractable.

### 9.1 Estimating the Effective Branching Factor

The effective branching factor `b_eff` of an IDA* search is defined implicitly by

```
N = b_eff^{C*}
```

where `N` is the total nodes generated and `C*` the solution depth, solved for `b_eff`. Measured values for the 15-puzzle:

```
heuristic                 approximate b_eff
Manhattan                 ~ 6.4   (raw, before reversal pruning effects vary)
Manhattan + reversal cut  ~ 2.13  (with reverse-move pruning)
Manhattan + linear conflict ~ 1.7 (illustrative)
7-8 additive PDB          ~ 1.4  (illustrative)
```

Each reduction in `b_eff` shrinks `b_eff^{80}` by an enormous factor on the diameter-80 instances. Lowering `b_eff` from 2.13 to 1.4 turns an infeasible search into a sub-second one — the empirical justification for investing in pattern databases.

### 9.2 The Surplus / Overestimation View

An alternative analysis (Korf, Reid, Edelkamp) predicts IDA* node counts from the *distribution* of heuristic values over the state space rather than `b_eff` alone. If `P(h ≤ x)` is the fraction of states with heuristic at most `x`, the expected nodes at threshold `d` is approximately

```
E[nodes] ≈ Σ_{i=0}^{d} (nodes at depth i) · P(h ≤ d − i)
```

i.e. a node at depth `i` survives pruning iff its heuristic is `≤ d − i`. A heuristic whose value distribution is shifted higher (more mass at large `h`) prunes more aggressively. This gives a predictive model of solver runtime from a one-time statistical profile of the heuristic — useful for choosing among PDB partitions without running full searches.

### 9.3 IDA* Variants and Their Guarantees

Several refinements preserve optimality while cutting work:

```
variant              idea                                      memory
IDA*                 f-bounded DFS, raise threshold            O(d)
IDA*+TT              add bounded transposition table           O(d) + cache
Recursive Best-First minimize re-expansion via backed-up f     O(d)
                     (RBFS, Korf 1993)
Frontier search      store only the search frontier            O(frontier)
MA* / SMA*           memory-bounded A*; prune worst leaves     O(budget)
```

**Recursive Best-First Search (RBFS)** is the closest relative: it keeps `O(d)` memory like IDA* but backs up the best alternative `f`-value at each node, so it re-expands fewer nodes than IDA* on graphs where many distinct thresholds occur. It retains optimality with an admissible heuristic by the same argument as Theorem 8.1 (the optimal path is never permanently abandoned). For the sliding puzzle with integer costs, IDA* and RBFS perform comparably; RBFS shines when edge costs are real-valued and thresholds proliferate.

**Lemma 9.1 (RBFS optimality).** With admissible `h`, RBFS returns an optimal solution. *Sketch:* RBFS only abandons a subtree when a sibling has a strictly smaller backed-up `f`, and it remembers the abandoned `f` to revisit later; since the optimal path's `f` never exceeds `C*`, it is never permanently discarded, and the first complete path returned has cost `C*`. ∎

---

## 10. NP-Hardness of the Generalized (N²−1)-Puzzle

The fixed-size 15-puzzle is solved in `O(1)` (constant-bounded diameter), but the **generalized** `(N²−1)`-puzzle, where `N` is part of the input, is hard to *optimize*.

**Theorem 10.1 (Ratner–Warmuth, 1990).** Deciding whether the `(N²−1)`-puzzle can be solved in at most `k` moves — equivalently, finding the **shortest** solution — is **NP-complete** (and the optimization version is NP-hard). Even approximating the optimal solution length within a constant factor is NP-hard.

**Proof sketch.** *Membership in NP:* a solution of length `≤ k` is a certificate verifiable in polynomial time (apply the moves; `k` is polynomially bounded for the YES instances of interest). *Hardness:* Ratner and Warmuth reduce from a known NP-complete problem by building gadget regions on a large board whose simultaneous "sorting" encodes the constraints; the minimum number of moves to resolve all gadgets corresponds to a solution of the source instance. The reduction shows that determining the optimal move count is at least as hard as the source problem, hence NP-hard. ∎

**Consequences.**
- **Feasibility is easy, optimization is hard.** Deciding *solvability* is `O(N²)` (parity, Section 3), and *some* solution of length `O(N³)` always exists and can be found greedily in polynomial time. It is finding the **shortest** that is NP-hard.
- **No polynomial optimal algorithm is expected.** IDA* + PDBs is exponential in the worst case; it is fast on the fixed 15-puzzle only because that size is constant. For growing `N`, optimal solving is intractable unless `P = NP`.
- **This justifies heuristic search.** Since exact optimization is NP-hard in general, the practical regime (fixed small boards) relies on strong admissible heuristics to keep the exponential constant small enough to finish.

**Distinction from the fixed-board diameters.** The 80-move diameter of the 15-puzzle is a constant; "NP-hard" refers to the family parameterized by `N`. The two statements are compatible: for each fixed `N` the problem is finite, but the *uniform* problem over all `N` has no efficient optimal algorithm expected.

### 10.1 The Approximation Hardness Strengthening

Ratner & Warmuth proved more than NP-completeness of the decision problem: finding a solution within a constant factor of optimal is also NP-hard. Concretely, there is no polynomial-time algorithm guaranteeing a solution of length `≤ α · C*` for any fixed `α < 4/3` (the exact inapproximability constant depends on the construction) unless `P = NP`. This rules out cheap constant-factor approximation as an escape — strong heuristic search on fixed sizes remains the only practical route to (near-)optimal solutions.

### 10.2 Polynomial Feasibility, Concretely

While optimization is hard, *a* solution is always findable in polynomial time:

```
greedy solve (not optimal):
  1. place the top row tiles one by one into position (rotating tiles in)
  2. place the leftmost column of the remaining sub-board
  3. recurse on the (s-1) x (s-1) sub-board
  4. solve the final 2x2 corner directly
```

This produces a solution of length `O(N³) = O(s^6)` in polynomial time. It is wildly sub-optimal (often 5–10× the optimum) but proves the gap: *deciding solvability* and *producing some solution* are easy; *minimizing moves* is the NP-hard part. Human "layer by layer" solving methods are exactly this polynomial greedy, which is why people can solve a 15-puzzle by hand but cannot easily find the optimum.

### 10.3 Relation to Other Hard Permutation Puzzles

The `(N²−1)`-puzzle joins a family of permutation-puzzle optimization problems known or conjectured hard: optimally solving Rubik's-cube-like puzzles parameterized by size, pancake sorting (related but distinct), and token-sliding reconfiguration problems. The common thread is that *reachability/feasibility* is governed by an easily-checked group invariant (parity here), while *optimal* reconfiguration is combinatorially explosive. The sliding puzzle is the cleanest classroom example of this feasibility-easy / optimization-hard dichotomy.

---

## 11. Summary

- **State space.** The `(s²−1)`-puzzle has `(s²)!` arrangements, of which exactly `(s²)!/2` are reachable (`181{,}440` for the 8-puzzle, `≈ 1.05 × 10^{13}` for the 15-puzzle), because a move is an odd permutation paired with a blank-distance parity flip, conserving `χ = sgn(π)·(−1)^{blankDist}`.
- **Solvability parity.** Horizontal moves leave `inv` unchanged; vertical moves change it by `s−1`. For odd `s`, `inv mod 2` is invariant (solvable iff even); for even `s`, `inv + blankRow mod 2` is invariant — the proven theorem behind the `O(N²)` solvability test.
- **Admissible heuristics.** Manhattan is admissible and consistent because each move changes a tile's distance by `±1`, so `MD ≤ C*`; linear conflict adds `2` per forced line-detour (a disjoint, uncounted set of moves) and stays admissible; Manhattan dominates Hamming.
- **Pattern databases.** Projecting onto a tile subset gives an admissible lower bound; with **own-group move accounting** over a **disjoint partition**, each real move is charged once, licensing the *additive* `Σ` of group databases (Theorem 7.3) — the strongest practical 15-puzzle heuristic, with reflection as a free `max` booster.
- **IDA* optimality.** With admissible `h`, the optimal path is never pruned once `bound ≥ C*`, and bounds rise to exactly the next achievable `f`, so the first solution found has length `C*`; completeness follows from finite bounded iterations.
- **Node count.** Geometric growth of nodes with the bound makes IDA*'s re-exploration a constant-factor overhead (`O(n_I)`); the analysis degrades only for near-linear (low-`b_eff`) graphs, not the puzzle.
- **Complexity.** The generalized `(N²−1)`-puzzle's optimal-solution problem is **NP-complete** (Ratner–Warmuth) and NP-hard even to approximate — feasibility is polynomial, optimization is not, which is exactly why strong admissible heuristics for the fixed sizes are the practical answer.

### Theorem Index

A consolidated map of the formal results, for quick reference:

```
Thm 2.1   reachable states = (s²)!/2          (parity invariant χ)
Prop 2.3  move graph connected on each half    (Wilson 1974)
Thm 3.1   solvability = inversion parity rule  (odd vs even width)
Prop 4.3  consistency ⇒ admissibility
Prop 4.4  consistent h ⇒ f non-decreasing
Thm 5.1   Manhattan is admissible
Thm 5.2   Manhattan is consistent
Thm 5.4   dominating h expands ⊆ nodes
Thm 6.2   linear conflict is admissible
Thm 7.1   single PDB is admissible
Thm 7.3   disjoint additive PDBs sum to admissible h
Lem 7.6   Lehmer rank is a bijection
Thm 8.1   IDA* returns an optimal solution
Thm 8.2   IDA* is complete
Thm 9.1   IDA* re-expansion overhead = O(n_I)  (geometric)
Lem 9.1   RBFS is optimal
Thm 10.1  generalized (N²−1)-puzzle is NP-complete (Ratner–Warmuth)
```

Each result is proved or sketched in its section above; together they form the complete correctness-and-complexity story: parity decides feasibility, admissible heuristics decide optimality, geometric growth bounds the cost, and NP-hardness explains why no polynomial optimal algorithm exists for the general family.

### Complexity Cheat Table

| Task | Complexity | Note |
|------|-----------|------|
| Solvability test | `O(N²)` | inversion parity + blank row |
| Manhattan / linear conflict | `O(N)` / `O(N·s)` | per state |
| Build additive PDB (group size `m`) | `O(s² · placements)` | one-time, backward 0/1-BFS |
| PDB lookup | `O(m)` (rank) | per node during search |
| IDA* optimal solve (fixed board) | exponential in `C*`, constant-factor overhead | `O(d)` memory |
| Optimal solve, generalized `N` | NP-hard | Ratner–Warmuth (1990) |
| BFS optimal (8-puzzle) | `O(states)` time and memory | feasible only at `s = 3` |

Foundational references: Wilson (1974) on the puzzle graph and the `(s²)!/2` reachable set; Johnson & Story (1879) on the parity/solvability invariant; Korf (1985) on IDA*; Hart, Nilsson & Raphael (1968) on A* and admissibility; the linear-conflict heuristic (Hansson–Mayer–Yung 1992); Culberson & Schaeffer (1998) and Korf & Felner (2002) on pattern databases and disjoint additive PDBs; Ratner & Warmuth (1990) on NP-completeness of the `(N²−1)`-puzzle.
