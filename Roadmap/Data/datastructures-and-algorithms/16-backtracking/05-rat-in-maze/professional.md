# Rat in a Maze (Grid Path Backtracking) — Mathematical Foundations and Complexity Theory

> Rat-in-a-Maze is, formally, the **simple-path** problem on a grid graph. That one identification organizes everything: the backtracking algorithm is a correct, exact enumerator of simple paths; the visited matrix is a provable invariant equal to the recursion stack; the cost is exponential because the *number* of simple paths is exponential; and the polynomial cousins (shortest path, monotone counting) are exactly the cases where the "no repeated cell" constraint is relaxed or made structurally vacuous. This document proves each of these claims.

## Table of Contents
1. [Formal Definitions](#1-formal-definitions)
2. [The Grid as a Graph](#2-the-grid-as-a-graph)
3. [Correctness of DFS Backtracking Enumeration (Each Simple Path Once)](#3-correctness-of-dfs-backtracking-enumeration-each-simple-path-once)
4. [The Visited-Matrix Invariant (Proof)](#4-the-visited-matrix-invariant-proof)
5. [Complexity: Why Enumeration Is Exponential](#5-complexity-why-enumeration-is-exponential)
6. [Grid-Path Counting in the Unobstructed Case: C(m+n, n)](#6-grid-path-counting-in-the-unobstructed-case-cmn-n)
7. [Lexicographic Order: Why Pre-Order DFS Sorts](#7-lexicographic-order-why-pre-order-dfs-sorts)
8. [Comparison with Shortest-Path Algorithms](#8-comparison-with-shortest-path-algorithms)
9. [Walks vs Simple Paths and the #P-Hardness Gap](#9-walks-vs-simple-paths-and-the-p-hardness-gap)
10. [Move-Set Generalizations and Their Path Counts](#10-move-set-generalizations-and-their-path-counts)
11. [Pruning: Soundness and Completeness](#11-pruning-soundness-and-completeness)
12. [Summary](#12-summary)

---

## 0. Notation and Conventions

Throughout, `n` and `m` are the grid's row and column counts; `N = n·m` is the cell count. `O` is the set of open cells, `s = (0,0)` the start, `g = (n-1,m-1)` the goal. `M` is the move-set (`M₄` for the classic 4 directions, `M₈` with diagonals), `b = |M|` the branching factor. `G_M = (O, E_M)` is the induced grid graph. `P(s,g)` is the set of simple `s`–`g` paths and `|P(s,g)|` its size. A **path** always means a *simple* path (no repeated cell) unless we explicitly say **walk** (repeats allowed). "Length" of a path means the number of **moves** (edges); a path through `k` cells has length `k-1`. The Iverson bracket `[P]` is `1` when predicate `P` holds and `0` otherwise. `C(a, b)` is the binomial coefficient "a choose b". We use `A^{(k)}`/`A^k` nowhere here (that is the walk-counting sibling); the rat problem is combinatorial-search, not linear-algebraic.

The document is organized as: definitions and the graph view (Sections 1–2); the three correctness pillars — enumeration, the visited invariant, and complexity (Sections 3–5); the polynomial special case and its combinatorics (Section 6); the lexicographic guarantee (Section 7); the optimization-vs-enumeration boundary (Section 8); the hardness gap (Section 9); move-set generalizations (Section 10); and pruning soundness (Section 11). Each major claim is a numbered theorem with a proof and, where instructive, a worked numerical example.

---

## 1. Formal Definitions

Let the maze be an `n × m` grid. Each cell `(r, c)` with `0 ≤ r < n`, `0 ≤ c < m` is either **open** or **blocked**. Write `O ⊆ {0,…,n-1} × {0,…,m-1}` for the set of open cells. The start is `s = (0, 0)` and the goal is `g = (n-1, m-1)`; both are assumed open unless stated otherwise.

**Definition 1.1 (Move-set).** A move-set `M` is a finite set of offset vectors `(δr, δc) ∈ ℤ²`. The classic Rat-in-a-Maze uses the 4-direction set `M₄ = {(+1,0), (0,-1), (0,+1), (-1,0)}` (Down, Left, Right, Up). The 8-direction set `M₈` adds the four diagonals.

**Definition 1.2 (Path / simple path).** A **path** from `u` to `w` is a sequence of cells `(p₀, p₁, …, p_L)` with `p₀ = u`, `p_L = w`, every `p_i ∈ O` (open), each step `p_{i+1} - p_i ∈ M` (a legal move), and — the defining constraint — all `p_i` **pairwise distinct** (a *simple* path, no repeated cell). `L` is the path **length in moves**; the path uses `L+1` cells.

**Definition 1.3 (Walk).** A **walk** relaxes Definition 1.2 by dropping the distinctness requirement: cells may repeat. Walks are the easy, polynomial object (matrix exponentiation, sibling topic); the Rat-in-a-Maze problem concerns **simple paths**, which is where the hardness lies.

**Definition 1.4 (Solution sets).** Let `P(s, g)` be the set of all simple paths from `s` to `g`. The problem variants are: (i) decide `P(s,g) ≠ ∅` (feasibility); (ii) produce one element (one path); (iii) produce all of `P(s,g)` (enumeration); (iv) produce `|P(s,g)|` (counting); (v) produce `min P(s,g)` under the lexicographic order on direction strings (smallest path).

**Remark.** The simple-path constraint (Definition 1.2) is the crux of the entire topic, exactly as in the walks-vs-paths distinction of the fixed-length sibling: the moment "no repeated cell" is required, the problem leaves the polynomial world (Section 9).

---

## 2. The Grid as a Graph

**Definition 2.1 (Grid graph).** Define `G_M = (O, E_M)` where the vertices are the open cells and `((r,c),(r',c')) ∈ E_M` iff `(r'-r, c'-c) ∈ M` and both endpoints are open. For `M₄` this is the standard 4-neighbor grid graph; it is undirected when `M` is symmetric (`M₄` and `M₈` are). Blocked cells are simply absent from `O`.

**Proposition 2.2.** A rat path under move-set `M` (Definition 1.2) is exactly a simple path in `G_M` between `s` and `g`. The maze problem is therefore the **simple-path** problem on a grid graph, and every result about simple paths in graphs specializes to it.

**Consequence.** The exponential count of simple paths (Section 5), the #P-hardness of counting them in general graphs (Section 9), and the polynomial shortest-path algorithms (Section 8) are all inherited from graph theory; the grid structure only fixes the degree (≤ 4 for `M₄`) and gives the clean unobstructed count of Section 6.

### 2.1 Grid-Specific Structure

The grid graph is not an arbitrary graph; it has exploitable structure that the general theory does not:

- **Bounded degree.** Every cell has at most `|M|` neighbors (≤ 4 for `M₄`, ≤ 8 for `M₈`), so `|E_M| = O(N)` — the graph is sparse. This bounds the BFS/DFS feasibility and shortest-path costs at `O(N)`.
- **Planarity.** The 4-direction grid graph is planar, which is why certain problems (e.g. counting on grid graphs) have specialized algorithms, though simple-path counting remains hard even on planar graphs.
- **Bipartiteness (4-direction).** Color cells by `(r + c) mod 2`; every `M₄` move flips the color, so `G_{M₄}` is bipartite. Consequently every closed walk has even length and there are no odd cycles — a fact that constrains which lengths of closed simple paths can exist (relevant to length-constrained variants).
- **Manhattan metric.** The graph distance under `M₄` equals the Manhattan distance only in the *unobstructed* grid; walls can only *increase* it. This is what makes Manhattan an admissible heuristic for A* (Section 8.2).

These properties make the *polynomial* questions (feasibility, shortest path) especially cheap on grids, while leaving the *enumeration/counting* questions as hard as on general graphs.

---

## 3. Correctness of DFS Backtracking Enumeration (Each Simple Path Once)

The central correctness claim: the backtracking DFS visits **every** simple path from `s` to `g` **exactly once**. We make this precise.

**Algorithm (recall).**
```
DFS(v):                      # v is the current cell
  if v == g: emit current path; return
  mark v as visited
  for each move δ in M (fixed order):
    w = v + δ
    if w in O and not visited[w]:
      DFS(w)
  unmark v                    # backtrack
```
The "current path" is the stack of cells from `s` to `v`; `emit` records the direction string of that stack.

**Theorem 3.1 (Soundness).** Every path emitted by `DFS(s)` is a simple path from `s` to `g`.

**Proof.** By construction, `emit` fires only when `v = g`, so every emitted path ends at `g` and starts at `s` (the recursion root). Each recursive call descends only to a `w` that is **open** (`w ∈ O`) and **not currently visited**. The set of currently-visited cells is exactly the cells on the current stack (Invariant, Section 4), so no cell on the path repeats — the emitted sequence is a *simple* path. Each step `w = v + δ` with `δ ∈ M` is a legal move. ∎

**Theorem 3.2 (Completeness, each path exactly once).** For every simple path `π = (s = p₀, p₁, …, p_L = g)`, `DFS(s)` emits `π` exactly once.

**Proof (induction on path length `L`).**

*Existence.* We show the recursion follows `π`. At `p₀ = s`, the cell is unvisited; the algorithm tries each move and in particular the move `δ₀ = p₁ - p₀ ∈ M`. At that point `p₁` is open and not visited (it is not on the current stack `{p₀}` since `π` is simple), so `DFS(p₁)` is called. Inductively, when the recursion is at `p_i` with the stack equal to `{p₀,…,p_i}`, the next cell `p_{i+1}` is open and not visited (it is not among `{p₀,…,p_i}` because `π` is simple), so the move `δ_i` is taken and `DFS(p_{i+1})` is called. After `L` steps the recursion reaches `p_L = g` and emits `π`.

*Uniqueness.* Suppose `π` were emitted twice. Two emissions correspond to two distinct sequences of recursive calls from the root to an `emit`. But the call sequence is uniquely determined by the sequence of cells visited (the move order is fixed, and the cell stack uniquely determines which call frame we are in). Two emissions of the *same* cell sequence `π` would require the recursion to reach the stack `(p₀,…,p_L)` twice, which is impossible: from each frame, each move `δ` is attempted exactly once (the `for` loop iterates `M` once), so the stack `(p₀,…,p_{i+1})` is reached at most once via the unique move `δ_i` from `(p₀,…,p_i)`. Hence each path is emitted at most once, and combined with existence, exactly once. ∎

**Corollary 3.3 (Counting correctness).** The count variant — incrementing a counter at each `emit` — returns `|P(s,g)|`, because each simple path contributes exactly one increment (Theorem 3.2).

**Corollary 3.4 (One-path correctness).** The one-path variant — returning `true` on the first `emit` — returns a valid simple path whenever `P(s,g) ≠ ∅`, by Theorem 3.2's existence half applied to any single path. If `P(s,g) = ∅`, no `emit` fires and the algorithm returns `false` (failure propagation), correctly reporting infeasibility.

### 3.1 Worked Enumeration: All Paths on a 2×2 Grid

Take the fully open `2 × 2` grid, `s = (0,0)`, `g = (1,1)`, move order D, L, R, U. The DFS explores the path-string trie in pre-order:

```
(0,0) -D-> (1,0) -R-> (1,1)   emit "DR"
(0,0) -R-> (0,1) -D-> (1,1)   emit "RD"
```

There are exactly two simple paths, `{DR, RD}`, and the DFS emits each once (Theorem 3.2) in sorted order (Theorem 7.1). The branches `(0,0)-D->(1,0)-D->oob`, `(1,0)-L->oob`, `(1,0)-U->(0,0) visited`, and symmetrically on the R side, all fail and are correctly not emitted. This tiny instance exhibits all three guarantees: soundness (both emitted are valid simple paths), completeness (no path missed), and uniqueness (no duplicate emission). It is also the empirical anchor a brute-force oracle would check against.

### 3.2 The Emission-to-Path Bijection

Theorem 3.2's uniqueness half established a **bijection** between simple `s`–`g` paths and `emit` events:
```
{simple paths s ⇝ g}  ≅  {emit events of DFS(s)}.
```
Soundness (3.1) gives the map from emissions to valid paths; completeness-existence (3.2) gives surjectivity (every path is emitted); completeness-uniqueness (3.2) gives injectivity (no path twice). A bijection between the solution set and the algorithm's success events is the cleanest possible statement of "correct enumeration", and it is what makes the counting corollary (3.3) immediate — counting emissions counts paths because the two sets are in bijection.

---

## 4. The Visited-Matrix Invariant (Proof)

The proofs above relied on a precise statement of what the visited matrix tracks. We prove it.

**Invariant 4.1 (Visited = current stack).** At every point during the execution of `DFS`, the set `{(r,c) : visited[r][c] = true}` equals exactly the set of cells on the current recursion stack (the cells from `s` to the currently-executing frame, inclusive).

**Proof (induction on the sequence of mark/unmark operations).**

*Base.* Before any call, `visited` is all-false and the stack is empty; the sets agree (both empty). At `DFS(s)`, `s` is marked and pushed; both sets are `{s}`.

*Inductive step.* Consider any single mark or unmark.
- **Mark (entering a frame).** `DFS(w)` marks `w` immediately upon entry, and `w` is simultaneously the new top of the stack. By the inductive hypothesis the visited set equaled the old stack; adding `w` to both keeps them equal. (Note `w` was not previously visited — it was checked `not visited[w]` before the call — so the mark genuinely adds a new element.)
- **Unmark (leaving a frame).** The `unmark v` line runs exactly when `DFS(v)`'s `for` loop has finished, i.e., the frame for `v` is about to return and be popped. Removing `v` from the visited set and popping `v` from the stack keep the two sets equal.

Every mutation of `visited` is one of these two operations (the algorithm contains exactly one `mark` and one `unmark`, both bracketing the body), and each preserves the equality. By induction the invariant holds throughout. ∎

**Corollary 4.2 (No repeats on a path).** Because `visited` equals the current stack, the check `not visited[w]` before recursing forbids stepping onto any cell already on the current path. Hence the algorithm explores only **simple** paths (used in Theorem 3.1).

**Corollary 4.3 (Restoration / idempotence).** After `DFS(s)` returns to the top level, the stack is empty, so by Invariant 4.1 the visited matrix is all-false again. This is the basis of the senior "visited-matrix-clean" test: a non-empty visited set after completion proves a missing `unmark`, i.e., a violation of the bracket structure the invariant assumes.

**Why the unmark is non-optional.** If `unmark` were omitted, Invariant 4.1 would fail: a cell could remain marked after its frame popped, so the visited set would strictly contain the current stack. Then a *sibling* branch — a different path not through that cell — would see it as falsely visited and skip it, violating completeness (Theorem 3.2). The unmark is precisely what restores the invariant on the way up, and it is the single line whose omission breaks correctness.

### 4.1 Worked Trace of the Invariant

Consider the `2 × 2` open maze with `s = (0,0)`, `g = (1,1)`, move order D, L, R, U. Track the marked set and the stack through the first path:

```
op                     stack                marked set
DFS(0,0) enter         [(0,0)]              {(0,0)}
  try D -> DFS(1,0)    [(0,0),(1,0)]        {(0,0),(1,0)}
    try D oob; L oob; R -> DFS(1,1)         [(0,0),(1,0),(1,1)]  {(0,0),(1,0),(1,1)}
      goal -> emit "DR"  (stack = path)
```

At every line the marked set equals the stack — Invariant 4.1 holds verbatim. After the search fully returns (all branches explored and popped), the marked set is `{}` again (Corollary 4.3). If we had omitted the `unmark` after `(1,0)` dead-ended in a different maze, `(1,0)` would stay in the marked set, and the alternative path `R, D` (through `(0,1)`) is unaffected — but a path that legitimately needed `(1,0)` again on a *different* trail would be wrongly blocked. This is the concrete failure the invariant rules out.

### 4.2 The Bracket Structure

The mark/unmark pair and the push/pop pair both form a **balanced bracket** sequence over the execution: each `mark`/`push` on entry has a matching `unmark`/`pop` on exit (except for the one emitted path in the one-path variant, which short-circuits the unwinding). This bracket discipline is exactly what makes the invariant an inductive property: every prefix of the execution has a well-defined "current open brackets" set, which is the stack, which is the marked set. Tooling can verify it cheaply — instrument `mark` and `unmark` to maintain a counter per cell and assert it never exceeds 1 and ends at 0.

---

## 5. Complexity: Why Enumeration Is Exponential

**Theorem 5.1 (Output-sensitive lower bound).** Any algorithm that emits all simple paths in `P(s,g)` runs in time `Ω(|P(s,g)|)`, and `|P(s,g)|` can be exponential in `N = n·m`. Hence enumeration is exponential in the worst case, regardless of algorithm.

**Proof.** Emitting `|P(s,g)|` distinct objects takes at least `|P(s,g)|` time. That `|P(s,g)|` can be exponential is witnessed already by the unobstructed monotone case (Section 6): `|P_monotone(s,g)| = C(n+m-2, n-1)`, which for a square grid `n = m` is `C(2n-2, n-1) = Θ(4^n / √n)` by Stirling — exponential in `n`, hence in `√N`. With full 4-direction freedom the count is far larger still. ∎

**Theorem 5.2 (Search-tree bound).** The backtracking DFS does `O(b^{L_max})` work in the worst case, where `b = |M|` is the branching factor (≤ 4 for `M₄`) and `L_max ≤ N` is the longest simple path. This is `O(4^N)` for `M₄`.

**Proof.** Each frame iterates over `|M|` moves; the recursion depth is bounded by the longest simple path `L_max ≤ N` (a simple path cannot exceed `N` cells). The recursion tree thus has at most `b^{L_max}` nodes, each doing `O(b)` constant work. ∎

**Tightness and the role of pruning.** The `4^N` bound is loose for real mazes: walls, the bounds check, and the visited check cut the tree drastically, and pruning (Section 11) cuts it more. But no amount of pruning makes enumeration polynomial, by Theorem 5.1 — the output itself is exponential. **Counting** is no easier in general (Section 9: #P-hard), with the crucial polynomial exception of monotone/DAG movement (Section 6), where the visited set is vacuous and a `O(N)` DP suffices.

**Space.** The extra space is `O(N)`: the recursion depth (`≤ N` frames) plus the `O(N)` visited matrix and the `O(N)` current path. The path *output* for "all paths" is separately `O(Σ |π|)`, which is exponential — hence the senior advice to stream rather than materialize.

### 5.1 The Free-Movement Count Concretely

For a fully open `n × n` grid with **all four** directions allowed, the number of simple `s`–`g` paths grows much faster than the monotone binomial. Small exact values (corner-to-corner, 4-direction simple paths) illustrate the explosion:

```
grid      monotone (D/R)      free 4-direction (all simple paths)
2 x 2     2                   2
3 x 3     6                   12
4 x 4     20                  184
5 x 5     70                  8512
6 x 6     252                 1262816
```

The monotone column is `C(2n-2, n-1)`; the free column has no closed form and roughly squares every couple of sizes. This table is exactly why "enumerate all paths" on anything beyond a tiny open grid is hopeless, and why the senior response is to challenge the requirement (Section 5 of `senior.md`).

### 5.1b Search-Tree Size vs Output Size

Two distinct exponentials live in Section 5, and conflating them is a common analysis error:

- **Search-tree size** (Theorem 5.2): `O(b^{L_max})` — the total number of recursive calls, including *failed* branches that dead-end without reaching `g`. Pruning attacks this term.
- **Output size** (Theorem 5.1): `Ω(|P(s,g)|)` — the number of *successful* leaves (emitted paths). Pruning cannot attack this; it is a hard floor.

On a heavily walled maze the search-tree size can be vastly larger than the output size (many doomed branches), so pruning yields enormous speedups. On a fully open maze the two are closer (most branches succeed), and pruning helps little. The ratio (search-tree size / output size) is precisely the efficiency pruning can recover — and on real mazes it is often astronomical, which is why pruning matters in practice despite Theorem 5.1.

### 5.2 Why Pruning Cannot Change the Class

A natural objection: "surely good pruning makes it polynomial on real inputs?" Pruning removes *branches that fail*, but the cost is at least the number of *successful* leaves (emitted paths), which is the output size. By Theorem 5.1 that is `Ω(|P(s,g)|)`, an exponential lower bound *independent of the algorithm*. Pruning attacks the gap between the search-tree size (Theorem 5.2) and the output size — real and often enormous on walled mazes — but the output size is a hard floor. The only escape is to change the *question* (count via DP when monotone, find one path, find the shortest path), not the algorithm.

---

## 6. Grid-Path Counting in the Unobstructed Case: C(m+n, n)

When no cells are blocked and movement is **monotone** (only Down and Right), the path count has a clean closed form — the canonical exponential witness and the basis of the polynomial DP.

**Theorem 6.1 (Monotone path count).** In an unobstructed `n × m` grid, the number of monotone paths (Down/Right only) from `(0,0)` to `(n-1, m-1)` is
```
C(n + m - 2, n - 1) = (n + m - 2)! / ((n-1)! (m-1)!).
```

**Proof (bijection).** A monotone path makes exactly `n-1` Down moves and `m-1` Right moves, in some order, for a total of `n+m-2` moves. Conversely, any arrangement of `n-1` D's and `m-1` R's is a valid monotone path (it never leaves the grid and reaches the goal). The paths are therefore in bijection with the binary strings of length `n+m-2` having exactly `n-1` D's, of which there are `C(n+m-2, n-1)`. ∎

**Remark (the form `C(m+n, n)`).** Up to the boundary convention (counting *cells* `n×m` vs *steps*), this is the binomial commonly quoted as `C(m+n, n)`. With `R = m-1` rights and `D = n-1` downs the exact statement is `C((n-1)+(m-1), n-1)`. The shape is what matters: a central binomial coefficient, exponential in the grid side.

**Corollary 6.2 (Polynomial DP, monotone).** Because monotone movement can never revisit a cell, the visited set is vacuous and the count satisfies
```
dp[r][c] = dp[r-1][c] + dp[r][c-1]   (0 if (r,c) blocked),  dp[0][0] = 1,
```
computable in `O(N)` time and `O(m)` space. This is the polynomial island inside the exponential sea: **drop the no-repeat constraint's teeth (make revisits structurally impossible) and counting collapses to a linear DP.** With obstacles, the same DP holds by zeroing blocked cells — still `O(N)`.

**Corollary 6.3 (Asymptotics).** For a square grid `n = m`, `C(2n-2, n-1) ∼ 4^{n-1} / √(π(n-1))` by Stirling. The monotone count alone is exponential in the side length, confirming Theorem 5.1's witness.

**The DP in pseudocode (monotone, with obstacles).**
```
COUNT-MONOTONE(maze):                # O(N) time, O(m) space with a rolling row
  dp := new array[m], all 0
  dp[0] := (maze[0][0] == open) ? 1 : 0
  for c in 1..m-1:                   # first row: only Right moves
    dp[c] := (maze[0][c] == open) ? dp[c-1] : 0
  for r in 1..n-1:
    dp[0] := (maze[r][0] == open) ? dp[0] : 0   # first column: only Down
    for c in 1..m-1:
      if maze[r][c] == blocked: dp[c] := 0
      else: dp[c] := dp[c] + dp[c-1]            # dp[c]=from above, dp[c-1]=from left
  return dp[m-1]
```
This is the "Unique Paths II" algorithm. Its correctness is Theorem 6.1 plus the observation that a blocked cell contributes `0` paths through it; its `O(N)` cost is the polynomial island of Corollary 6.2.

**Why free movement is not a binomial.** With all four directions, paths may go Up/Left, so the bijection to D/R strings breaks and no simple closed form exists; the count is the general grid-graph simple-path count, which grows much faster and has no known polynomial formula — it is the #P-hard regime (Section 9).

### 6.1 Worked DP Count with Obstacles

Take the `3 × 3` maze with a single wall at `(1,1)`, monotone movement:

```
maze (1=open):        dp (monotone path counts):
1 1 1                 1 1 1
1 0 1                 1 0 1
1 1 1                 1 1 2
```

`dp[0][*] = 1` (only Rights reach the top row); `dp[*][0] = 1` (only Downs reach the left column). `dp[1][1] = 0` (blocked). `dp[1][2] = dp[0][2] + dp[1][1] = 1 + 0 = 1`. `dp[2][1] = dp[1][1] + dp[2][0] = 0 + 1 = 1`. `dp[2][2] = dp[1][2] + dp[2][1] = 1 + 1 = 2`. So there are **2** monotone paths, computed in `O(N)` — no backtracking. The unobstructed `3×3` would give `C(4,2) = 6`; the wall removes 4 of them.

### 6.2 The Delannoy and Catalan Specializations

The move-set determines which combinatorial family the count belongs to:

- **D/R only:** binomial `C(n+m-2, n-1)` (Theorem 6.1).
- **D/R/diagonal-DR:** central Delannoy numbers, recurrence `D[r][c] = D[r-1][c] + D[r][c-1] + D[r-1][c-1]`; the diagonal cuts moves, inflating the count. Central Delannoy numbers `1, 3, 13, 63, 321, …` grow like `(3 + 2√2)^n / √n`.
- **Monotone staying weakly below the main diagonal:** Catalan numbers `C_k = (1/(k+1))C(2k, k)`, the classic "ballot" / "balanced parentheses" count.

All three are DAG counts (no revisits possible), hence all `O(N)` DPs. The unifying principle (formalized in Section 10): **acyclic move-sets give polynomial DP counts; cyclic move-sets give the #P-hard simple-path count.**

---

## 7. Lexicographic Order: Why Pre-Order DFS Sorts

**Theorem 7.1.** If the move-set is iterated in a fixed order whose letters are alphabetically increasing (for `M₄`: D < L < R < U), then the backtracking DFS emits the simple paths of `P(s,g)` in lexicographically non-decreasing order of their direction strings. Consequently the **first** emitted path is the lexicographically smallest, and the full emission is already sorted.

**Proof.** Consider the trie (prefix tree) `T` whose nodes are direction-string prefixes of paths and whose children are ordered by the move order D < L < R < U. The DFS performs a **pre-order traversal** of `T`: from a node it visits children in increasing letter order, fully exploring each subtree before the next. A standard fact about pre-order traversal of a children-sorted trie is that it visits the leaves (here, complete paths to `g`) in lexicographic order of their root-to-leaf strings: for any two leaves with strings `α` and `β`, at their first differing position the one with the smaller letter lies in an earlier-visited subtree, hence is emitted first; if one is a prefix of the other, the shorter (prefix) is emitted first, matching dictionary order. Therefore emissions are sorted, and the first is the minimum. ∎

**Corollary 7.2 (Early stop is safe).** For the "smallest path" variant, returning on the first `emit` yields the global minimum (Theorem 7.1), so the early termination is correct, not merely heuristic.

**Caveat (length vs dictionary order).** Theorem 7.1 concerns the *dictionary* order on strings, **not** length. The lexicographically smallest path may be longer than the shortest path. If "smallest" means *fewest moves*, that is the shortest-path problem (Section 8, BFS), and DFS order gives no such guarantee.

### 7.1 A Counterexample: Lex-Smallest ≠ Shortest

Consider a maze where from the start a long "D-heavy" detour reaches the goal, while a short "R-heavy" route also exists. Because `D < R`, DFS explores the D-branch first and may emit a long path like `DDDD…RRRR` before it would ever try the short `RD`. The lexicographically smallest path string can therefore be strictly longer (more moves) than the BFS shortest path. The two notions of "smallest" — dictionary order vs move count — are genuinely different objectives, and only BFS guarantees the latter. This is the formal backing for the repeated cross-file warning that "smallest" must be disambiguated before coding.

### 7.2 Generating All Paths in Sorted Order

A corollary worth stating separately: for the *all-paths* variant, the pre-order property (Theorem 7.1) means the emitted sequence of path strings is **already sorted** — no `O(P log P)` sort over the (exponentially many) paths is needed. This matters because sorting the output could dominate even the exponential generation. Emitting in order is free; sorting afterward is not. The same trie-pre-order argument gives it.

### 7.3 Formal Pre-Order Statement

Let `T` be the trie of path-string prefixes with children ordered D < L < R < U. Define the pre-order leaf sequence `leaves(T)`.

**Lemma 7.2.** For two leaves with strings `α, β` and least common ancestor at depth `d`, `α` precedes `β` in `leaves(T)` iff `α[d] < β[d]` in the move order (or `α` is a proper prefix of `β`).

**Proof.** Pre-order visits a node's children left-to-right (increasing move letter), fully completing each child's subtree before the next. At the LCA, `α` and `β` diverge into different children; the one in the earlier (smaller-letter) child is visited first. If one is a prefix of the other, the prefix's leaf (the goal reached earlier along the shared branch) is visited before descending further, matching dictionary order where the shorter string precedes. ∎

Theorem 7.1 is the specialization of Lemma 7.2 to the leaves that reach `g`. The lexicographic guarantee is thus a pure property of children-sorted pre-order traversal, independent of the maze.

---

## 8. Comparison with Shortest-Path Algorithms

The maze admits two fundamentally different questions, separated by whether you **optimize one path** or **enumerate many**.

**Theorem 8.1 (BFS optimality, unit cost).** On `G_M` with unit edge costs, breadth-first search from `s` dequeues `g` at distance equal to the minimum number of moves in any `s`–`g` path, in `O(|O| + |E_M|) = O(N)` time.

**Proof.** BFS processes vertices in non-decreasing distance from `s` (standard BFS layering). The first time `g` is dequeued, its recorded distance is the shortest; permanent marking ensures each vertex is settled once, giving the linear bound. ∎

**Contrast with backtracking.** BFS marks each vertex visited **permanently** — once settled at its optimal distance, never reconsidered — yielding `O(N)`. Backtracking marks visited **only on the current trail** and *un-marks* (Invariant 4.1), because a vertex lies on exponentially many enumerated paths. This single difference — permanent vs trail-scoped visited — is exactly why one is polynomial (optimize) and the other exponential (enumerate).

**Theorem 8.2 (Algorithm selection).**

| Question | Algorithm | Complexity | Visited semantics |
|----------|-----------|-----------|-------------------|
| Feasibility (∃ path) | BFS/DFS | `O(N)` | permanent |
| Shortest (unit cost) | BFS | `O(N)` | permanent |
| Shortest (weights ≥ 0) | Dijkstra | `O(E log V)` | permanent (settled) |
| Shortest (heuristic) | A* | `O(E)` typical | permanent |
| All / constraint paths | DFS backtracking | exponential | trail-scoped (un-marked) |
| Count (monotone) | DP | `O(N)` | none (DAG) |
| Count (free movement) | backtracking | exponential / #P-hard | trail-scoped |

The throughline: **permanent-visited ⇒ polynomial optimization; trail-scoped-visited ⇒ exponential enumeration.** Choosing the wrong one is the dominant correctness/performance error (a backtracker asked for the shortest path can be exponentially slow and return a suboptimal route).

### 8.1 Why Permanent Visited Is Sound for Shortest Path

**Proposition 8.3.** Marking a vertex permanently visited in BFS (never reconsidering it) does not lose the shortest path.

**Proof.** When BFS first dequeues `v`, its distance `d(v)` is final and minimal (BFS layering). Any later arrival at `v` would be via a path of length `≥ d(v)`, so reconsidering `v` could only produce an equal-or-longer route to anything reached through it. Hence permanent marking discards only non-improving paths, preserving the shortest. ∎

This is exactly the property that **fails** for enumeration: there, *all* routes through `v` matter, not just the shortest, so `v` cannot be permanently settled — it must be un-marked to re-enable other trails. The two visited-semantics are each *correct for their own objective and incorrect for the other's*. Using permanent visited for enumeration loses paths; using trail-scoped visited for shortest path is exponentially slow. Proposition 8.3 (optimization) and Invariant 4.1 (enumeration) are the two sides of this coin.

### 8.2 A* and Admissible Heuristics on Grids

For a single shortest path, A* orders the frontier by `f(v) = g(v) + h(v)`, where `g(v)` is the cost from the start and `h(v)` is a heuristic lower bound on the cost to the goal. On a 4-direction unit-cost grid the **Manhattan distance** `h(v) = |r_v - r_g| + |c_v - c_g|` is admissible (never overestimates) and consistent, so A* returns the optimal path and expands no more cells than necessary. For 8-direction movement use the Chebyshev/octile distance. A* is still a permanent-visited, optimize-one-path algorithm — never an enumerator — reinforcing the Section 8 boundary at the level of heuristic search.

**Theorem 8.4 (A* optimality).** With an admissible heuristic, A* returns a minimum-cost path.

**Proof sketch.** When A* selects the goal `g` for expansion, `f(g) = g(g)` (since `h(g) = 0`) is the priority; for any other frontier node `v`, `f(v) = g(v) + h(v) ≤` true cost of the best path through `v` to `g` (admissibility). Since `g` was selected with the minimum `f`, no frontier path can complete to a cheaper goal route. Hence the returned `g(g)` is optimal. ∎

---

## 9. Walks vs Simple Paths and the #P-Hardness Gap

The efficiency of optimization (Section 8) and of monotone counting (Section 6) both rely on *not* enforcing the simple-path constraint in a hard way. Enforcing it for counting is intractable.

**Definition 9.1.** `#SIMPLE-PATHS`: given a graph `G` and vertices `s, t`, count the simple `s`–`t` paths. `#k-PATHS`: count the simple `s`–`t` paths of length exactly `k`.

**Theorem 9.2.** Counting simple `s`–`t` paths is **#P-complete**, and counting Hamiltonian paths (`k = |V|-1`) is #P-complete (Valiant 1979). Hence there is no polynomial algorithm for general simple-path counting unless `FP = #P`.

**Proof sketch.** The decision version of Hamiltonian path is NP-complete (Karp 1972); its counting version counts solutions of an NP-complete predicate, which is #P-complete by Valiant's framework. General `#SIMPLE-PATHS` is #P-hard by reduction from Hamiltonian-path counting. ∎

**Specialization to grids.** Counting simple paths in grid graphs is also #P-hard (the problem remains hard on planar and on grid-like graphs). This is why the **free-movement** rat path count (Section 6's non-monotone case) has no closed form and no known polynomial algorithm — backtracking enumeration is essentially the only general method, and it is exponential.

**Why walks are easy but simple paths are hard.** The walk recurrence is **memoryless**: extending a walk needs only the current cell, so iterating the transition `k` times is a matrix power, polynomial (sibling fixed-length topic). The simple-path recurrence must track the **visited set** (Invariant 4.1), blowing the state to `2^N` subsets. The visited matrix that makes the rat search *correct* is exactly the non-local state that makes it *exponential*.

**A vivid contrast.** On a fully open `3 × 3` grid, the number of length-4 *walks* from `(0,0)` to `(0,0)` (returns allowed) is a polynomial-time matrix-power computation and is positive (e.g. `(0,0)→(0,1)→(0,0)→(1,0)→(0,0)`). The number of length-4 *simple paths* from `(0,0)` to `(0,0)` is `0` — a simple closed path of length 4 needs 4 distinct intermediate cells returning to the start, impossible without repeating. The walk count and the simple-path count are not merely different in magnitude; they answer structurally different questions, and no post-processing converts one into the other. This is the operational form of the #P-hardness gap.

**Practical corollary.** Never use a walk-counting method (matrix power) to count simple rat paths — it overcounts by including routes that revisit cells. The walks-vs-paths boundary is the single most important hardness fact for this topic, mirroring the same boundary in the fixed-length sibling.

### 9.1 The Held-Karp Subset DP (Exact, Exponential)

When you *must* count or find a length-`k` simple path or a Hamiltonian path on a small grid, the exact method is the Bellman-Held-Karp subset DP, whose state is precisely the visited-set that backtracking carries implicitly:

```
dp[S][v] = number of simple paths that visit exactly the cell-set S and end at v
dp[{s}][s] = 1
dp[S ∪ {w}][w] = Σ over v in S, (v,w) an edge, of dp[S][v]
answer = dp[full or required S][g]
```

This is `O(2^N · N²)` time and `O(2^N · N)` space — feasible only for `N ≲ 20`. It makes the exponential **explicit in the subset index**, confirming Section 10.2's claim that the visited set is the load-bearing, non-local state. Backtracking is the same computation done lazily without the table; the subset DP trades memory for avoiding recomputation, but neither escapes the exponential because the underlying problem is #P-hard.

### 9.2 Parameterized Tractability (Color-Coding)

For *detecting* (not counting) a length-`k` simple path, color-coding (Alon-Yuster-Zwick 1995) runs in `2^{O(k)} · poly(N)` randomized time — exponential in the *path length* `k`, not the grid size `N`. For small `k` on a large grid this beats both backtracking and Held-Karp. It does not help the rat's corner-to-corner question (where `k` can be `Θ(N)`), but it is the right tool for "is there a length-≤-k path" with small `k`, and it is worth naming as the boundary of what parameterization buys.

| Problem | Complexity | Method |
|---------|-----------|--------|
| Count simple paths (free) | `#P`-hard | backtracking / Held-Karp `O(2^N N²)` |
| Detect length-`k` simple path | `2^{O(k)} poly(N)` | color-coding |
| Count monotone paths | `O(N)` | DP |
| Shortest path | `O(N)` | BFS |
| One path / feasibility | `O(N)` | BFS/DFS |

---

## 10. Move-Set Generalizations and Their Path Counts

The backtracking correctness proofs (Sections 3–4) used only that `M` is a finite move-set; they hold verbatim for any `M`. The *counts*, however, depend on `M`.

**Proposition 10.1 (Move-set agnosticism).** Theorems 3.1, 3.2, and Invariant 4.1 hold for any move-set `M`, with branching factor `b = |M|` in Theorem 5.2. Diagonal (`M₈`), jump (`(±k,0),(0,±k)`), and knight (`(±1,±2),(±2,±1)`) move-sets all enumerate their simple paths exactly once.

**Proof.** None of the proofs used the specific offsets of `M₄` — only that each frame iterates a fixed finite list of moves once, and that a step adds `δ ∈ M`. Substituting any finite `M` leaves every argument intact; `b = |M|` updates the branching factor in Theorem 5.2. ∎

**Counting under different move-sets.**
- **Monotone (D/R):** `C(n+m-2, n-1)` (Theorem 6.1), polynomial DP.
- **Monotone with diagonals (D/R/DR):** Delannoy-number recurrence `D[r][c] = D[r-1][c] + D[r][c-1] + D[r-1][c-1]`; still a DAG, still `O(N)` DP. The central Delannoy numbers grow like `(3 + 2√2)^n`.
- **Free 4/8-direction:** simple-path count, no closed form, #P-hard (Section 9), exponential enumeration only.
- **Lattice paths staying weakly below the diagonal:** Catalan numbers `C_k = (1/(k+1))C(2k,k)`, the classic constrained-monotone count.

The pattern: **acyclic (monotone) move-sets give DP-countable polynomial families (binomial, Delannoy, Catalan); cyclic (free) move-sets give the #P-hard simple-path count.** Acyclicity, equivalently "the visited set can be dropped", is the exact dividing line.

### 10.1 Formalizing the Acyclicity Dividing Line

**Proposition 10.2 (DAG ⇒ polynomial counting).** If the move-set `M` induces a directed acyclic graph `G_M` on the open cells (no directed cycle is possible), then every walk is automatically a simple path (a cell cannot recur without a cycle), so the visited set is vacuous, and the path count satisfies a topological-order DP:
```
count[v] = Σ over predecessors u of v of count[u],   count[s] = 1,
answer = count[g].
```
computable in `O(|O| + |E_M|) = O(N)`.

**Proof.** In a DAG, no directed walk repeats a vertex (a repeat would close a directed cycle, contradicting acyclicity). Hence every `s`–`g` walk is a simple path, and the number of walks ending at `v` decomposes by last edge into the sum over predecessors — a linear recurrence evaluable in topological order. ∎

**Why monotone movement is a DAG.** With Down/Right (or Down/Right/diagonal-DR) moves, every step strictly increases `r + c`, so no cell can recur — the graph is acyclic. This is the precise structural reason the binomial/Delannoy DPs work and the general 4-direction count does not: adding Up/Left edges creates cycles, reintroducing the visited-set dependence and the #P-hardness.

**Corollary 10.3.** Any move-set with a strict monovariant (a function `φ` on cells that strictly increases along every move) yields a DAG and hence `O(N)` counting. `φ(r,c) = r + c` works for D/R; `φ(r,c) = r` works for "Down and same-row horizontal in one direction"; no such `φ` exists for the full 4-direction set, which is why it is hard.

**Summary of the move-set spectrum.** Ordered from easiest to hardest counting:

| Move-set | Cyclic? | Count family | Cost |
|----------|---------|--------------|------|
| Down, Right | no (DAG) | binomial `C(n+m-2,n-1)` | `O(N)` |
| Down, Right, diag-DR | no (DAG) | Delannoy | `O(N)` |
| monotone below diagonal | no (DAG) | Catalan | `O(N)` |
| full 4-direction (D,L,R,U) | yes | no closed form | `#P`-hard / exponential |
| full 8-direction | yes | no closed form | `#P`-hard / exponential |
| knight moves | yes | no closed form | `#P`-hard / exponential |

The line between rows 3 and 4 is acyclicity (Proposition 10.2), and it is the single most important structural fact for predicting whether a given maze-counting problem is tractable.

---

## 11. Pruning: Soundness and Completeness

Pruning removes branches; a *sound* prune never removes a branch containing a solution, so the pruned search remains complete.

**Definition 11.1 (Sound prune).** A prune is **sound** if, whenever it abandons a partial path `(p₀,…,p_i)`, no extension of that partial path to a goal path exists in `P(s,g)`.

**Theorem 11.2 (Reachability prune is sound).** Let `R = {v ∈ O : ∃ a path v ⇝ g in G_M}`, computed by a flood from `g` over `M⁻¹` (the reversed move-set; `M⁻¹ = M` when `M` is symmetric). Abandoning any partial path whose current cell `p_i ∉ R` is sound.

**Proof.** If `p_i ∉ R`, then by definition no path from `p_i` to `g` exists in `G_M`. Any extension of the partial path must continue from `p_i` to `g`, which is impossible. Hence the abandoned branch contains no goal path, and removing it preserves completeness (Theorem 3.2 still holds on the surviving tree). The flood is `O(N)`; it must use the *same* move-set the search uses, or `R` is wrong (a correctness pitfall). ∎

**Theorem 11.3 (Length-bound prune is sound, bounded variant).** For searches with a move budget `L`, abandoning a partial path when `i + h(p_i) > L`, where `h` is an **admissible** lower bound on remaining moves (Manhattan distance for `M₄`, Chebyshev for `M₈`), is sound.

**Proof.** Admissibility means `h(p_i) ≤` the true minimum remaining moves from `p_i` to `g`. If `i + h(p_i) > L`, then any completion needs `> L` total moves, exceeding the budget; no valid (within-budget) goal path extends this partial path. Sound. ∎

**Theorem 11.4 (Connectivity prune for visit-all variants).** In the "visit every open cell" (Hamiltonian) variant, abandoning a partial path whenever the unvisited open cells become **disconnected** in `G_M` (excluding the current cell's onward reach) is sound, because a single continuing path cannot cover two disconnected components.

**Proof.** A simple path is a single connected sequence; from `p_i` it can reach only cells in `p_i`'s component of the remaining open subgraph. If the remaining required cells span ≥ 2 components, at least one is unreachable, so no completion covers all — the branch is solution-free. Sound. ∎

**Worked connectivity prune.** In a "visit every open cell" search on a `1 × 5` corridor `s · · · g`, suppose the partial path goes `s → cell1 → cell3` by some non-adjacent route that strands `cell2` between two visited cells. The remaining unvisited required set `{cell2, g}` is now disconnected from the current cell's reachable region (`cell2` is boxed in). The connectivity flood detects two components, and the branch is pruned immediately — no need to explore the doomed continuation. On Hamiltonian-grid instances this prune routinely removes the vast majority of the search tree, turning an otherwise hopeless `O(2^N N²)`-scale search into something that finishes, though (Section 5.2) it cannot change the worst-case class.

**Caveat: pruning does not change asymptotics.** All prunes are sound (preserve completeness) but, by Theorem 5.1, cannot make enumeration polynomial — the output is exponential. Pruning improves the *typical* running time on structured inputs by orders of magnitude; it is an engineering win, not a complexity-class change.

### 11.1 Worked Reachability Prune

Take the maze with a walled-off pocket:

```
maze (1=open):     R = cells that can reach goal (reverse flood from (3,3)):
1 1 0 0            T T . .
1 0 0 1            T . . F      <- (1,3) is open but cannot reach goal: walled pocket
1 1 1 1            T T T T
0 0 1 1            . . T T
```

The reverse flood from `g = (3,3)` over `M₄` marks `R`. Cell `(1,3)` is open but isolated from the goal-connected region, so `R[1][3] = false`. During backtracking, the moment the rat would step onto `(1,3)` the prune (Theorem 11.2) abandons the branch in `O(1)`, never exploring the dead pocket. The flood itself is one `O(N)` BFS. On mazes with large dead regions this is the dominant practical speedup, though by Section 5.2 it still cannot make the worst case polynomial.

### 11.2 Soundness Is Not Optional

A subtle but critical point: an *unsound* prune (one that may discard a branch containing a solution) silently corrupts the answer — it makes the enumeration *incomplete* (Theorem 3.2 fails) without any crash or obvious symptom. The reachability prune is sound only when the flood uses the **exact same move-set** as the forward search; a 4-direction flood paired with an 8-direction search would wrongly mark some reachable cells as unreachable and lose paths. The senior failure mode "reachability prune with the wrong move-set" (`senior.md` §10.8) is exactly a soundness violation of Theorem 11.2's hypothesis.

### 11.3 Combining Prunes

Prunes compose: applying reachability, then admissible length-bound, then connectivity prunes in sequence is sound iff each is individually sound (the intersection of sound restrictions is sound, since none discards a solution-bearing branch). Order them by cost — cheapest, highest-yield first (the `O(1)` reachability lookup before the `O(N)` connectivity flood) — so the expensive checks run only on branches that survive the cheap ones. This is standard constraint-propagation engineering applied to the maze search.

### 11.4 Pruned DFS in Pseudocode

```
PRECOMPUTE: R := reverse-flood from g over the SAME move-set M   # O(N)

DFS-PRUNED(v):
  if v ∉ O or visited[v] or v ∉ R:  return        # bounds/open/visited/reachable
  if budget set and steps + h(v) > L: return       # admissible length bound
  if v == g: emit; return
  mark v
  for δ in M (fixed order):
    DFS-PRUNED(v + δ)
  unmark v                                          # backtrack restores invariant
```

Every added test (`v ∉ R`, the length bound) is a sound prune (Theorems 11.2–11.3), so the pruned search is still a complete, exactly-once enumerator (Theorem 3.2 holds on the surviving tree). The invariant of Section 4 is untouched — prunes only *prevent entering* a cell, they never change the mark/unmark bracket structure. Hence the visited-clean diagnostic (Corollary 4.3) remains valid for the pruned version too.

---

## 12. Summary

- **The problem is the simple-path problem on a grid graph** (`G_M`, Proposition 2.2): open cells are vertices, legal moves are edges, and a rat path is a simple `s`–`g` path. Every graph-theoretic result specializes here.
- **Backtracking is correct (Theorems 3.1–3.2):** it emits each simple path exactly once, by following any path's unique cell sequence and trying each move once per frame. Counting and one-path variants inherit correctness as corollaries.
- **The visited matrix equals the current recursion stack (Invariant 4.1).** This is what enforces "no repeated cell" (simple paths) and what the **un-mark** restores on the way up. Omitting the un-mark breaks the invariant and loses paths; the post-run all-false check is its diagnostic.
- **Enumeration is exponential (Theorems 5.1–5.2):** the *output* — the number of simple paths — is exponential, witnessed already by the monotone `C(n+m-2, n-1)` count; no algorithm escapes `Ω(|P(s,g)|)`.
- **Unobstructed monotone counting is polynomial (Theorem 6.1, Cor. 6.2):** `C(n+m-2, n-1)` paths, computable by an `O(N)` DP, because monotone movement makes revisits impossible and the visited set vacuous. Diagonals give Delannoy numbers; below-diagonal constraint gives Catalan.
- **Lexicographic order is free (Theorem 7.1):** pre-order DFS with D < L < R < U visits path strings in dictionary order, so the first found is the smallest. This is string order, not length order.
- **Optimization vs enumeration (Section 8):** shortest path is BFS/Dijkstra/A* with **permanent** visited (`O(N)`); enumeration is backtracking with **trail-scoped** visited (exponential). Permanent vs trail-scoped is the dividing line.
- **#P-hardness gap (Section 9):** counting simple paths is #P-complete (Hamiltonian-path counting), because the visited-set state is non-local — the very state the rat search must carry. Walks (memoryless) are polynomial; simple paths are not.
- **Pruning is sound but not asymptotics-changing (Section 11):** reachability, admissible length bounds, and connectivity prunes preserve completeness and slash typical time, but cannot beat the exponential output lower bound.

### Complexity Cheat Table

| Task | Movement | Complexity | Tight? |
|------|----------|-----------|--------|
| Feasibility / one path | any | `O(N)` (BFS/DFS) | yes |
| Shortest path | unit cost | `O(N)` (BFS) | yes |
| Count paths | monotone (DAG) | `O(N)` DP | yes |
| Count paths | free 4/8-dir | `#P`-hard | no poly algorithm |
| Enumerate all paths | any | `Ω(|P(s,g)|)`, exponential | output-tight |
| Smallest path (lex) | any, D,L,R,U | exponential worst case | first emit is min |

### Closing Notes

- **The simple-path constraint is everything** (Sections 1, 9): dropping "no repeated cell" turns the hard problem into the easy walk-counting one (matrix power); enforcing it forces the visited-set state and the #P-hardness. The rat search is the simple-path problem, so it inherits the hardness.
- **The visited matrix is the recursion stack** (Invariant 4.1): a one-line inductive invariant that simultaneously justifies correctness (simple paths), the mandatory un-mark, and the diagnostic all-false-after-completion test.
- **Output-sensitivity is a hard floor** (Theorem 5.1, Section 5.2): no algorithm and no pruning beats `Ω(|P(s,g)|)`; the only escape from exponential is to change the question (count via DP when monotone, find one, find the shortest).
- **Acyclicity is the polynomial/exponential dividing line** (Section 10): monotone (DAG) movement drops the visited set and counts in `O(N)` via binomial/Delannoy/Catalan DPs; cyclic (free) movement is #P-hard.
- **Permanent vs trail-scoped visited** (Section 8): the same data structure, two semantics — permanent for *optimize one* path (BFS/Dijkstra/A*, polynomial), trail-scoped for *enumerate many* (backtracking, exponential). Each is correct only for its own objective.
- **Lexicographic order is free but distinct from length** (Section 7): pre-order DFS in D,L,R,U emits sorted strings, but the smallest string need not be the shortest path — disambiguate before coding.

Foundational references: Valiant (1979) for #P-completeness of counting; Karp (1972) for Hamiltonian-path NP-completeness; Alon-Yuster-Zwick (1995) for color-coding; Bellman / Held-Karp for the subset DP; standard lattice-path combinatorics for binomial/Delannoy/Catalan counts (Stanley, *Enumerative Combinatorics*); CLRS for BFS/DFS/Dijkstra; Hart-Nilsson-Raphael (1968) for A* and admissible heuristics. Sibling topics: the general backtracking template in `16-backtracking`, BFS shortest path in `11-graphs`, and fixed-length *walk* counting (the polynomial, memoryless cousin) in the `paths-fixed-length` topic.
