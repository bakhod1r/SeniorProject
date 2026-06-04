# Knight's Tour (Backtracking + Warnsdorff's Heuristic) — Professional / Theory Level

> **Focus:** The mathematical foundations. The **knight graph**; a tour as a **Hamiltonian path/cycle** (NP-hard in general); **Schwenk's theorem** on exactly which rectangular boards admit closed tours; Warnsdorff's rule as a **greedy heuristic with no guarantee** (and explicit counterexamples); the **complexity** of naive backtracking; and **existence/counting** results.

---

## Table of Contents

1. [Introduction](#introduction)
2. [The Knight Graph](#the-knight-graph)
3. [Tours as Hamiltonian Paths and Cycles](#tours-as-hamiltonian-paths-and-cycles)
4. [NP-Hardness in General](#np-hardness-in-general)
5. [Schwenk's Theorem (Closed Tours)](#schwenks-theorem-closed-tours)
6. [Open-Tour Existence](#open-tour-existence)
7. [Warnsdorff as a Greedy Heuristic](#warnsdorff-as-a-greedy-heuristic)
8. [Counterexamples to Pure Warnsdorff](#counterexamples-to-pure-warnsdorff)
9. [Complexity of Naive Backtracking](#complexity-of-naive-backtracking)
10. [Constructive Methods and Linear-Time Tours](#constructive-methods-and-linear-time-tours)
11. [Counting Results](#counting-results)
12. [Code Examples](#code-examples)
13. [Spectral and Algebraic Notes](#spectral-and-algebraic-notes)
14. [Relationship to Other Hard Problems](#relationship-to-other-hard-problems)
15. [Summary](#summary)
16. [Further Reading](#further-reading)

---

## Introduction

The Knight's Tour sits at a rich intersection of graph theory, complexity theory, and the analysis of heuristics. The folklore version ("a fun chess puzzle") hides several deep facts:

- A tour is a **Hamiltonian path** in a specific graph — so the *general* problem is NP-hard.
- Yet the knight graph is structured enough that we have **exact existence theorems** (Schwenk) and **linear-time constructive algorithms**, neither of which exist for arbitrary graphs.
- Warnsdorff's rule is a **greedy heuristic** that works astonishingly often but provably **does not always work** — a clean case study in "fast in practice, no worst-case guarantee".

This file develops these foundations carefully and states the key theorems precisely. Throughout, the recurring thesis is the same: **the Knight's Tour is a worst-case-hard problem made easy by the special structure of one particular graph.** Every section below is an instance of that thesis — the graph's bipartiteness gives parity necessary conditions, its regularity gives Schwenk's finite obstruction list, its sparsity makes Warnsdorff effective, and its recursive self-similarity gives linear-time constructions. Keeping that thesis in mind ties the theorems together rather than leaving them as disconnected facts.

---

## The Knight Graph

For an `M×N` board, define the **knight graph** `G = (V, E)`:

- **Vertices** `V`: the `MN` squares, identified with coordinates `(r, c)`, `0 ≤ r < M`, `0 ≤ c < N`.
- **Edges** `E`: `{(r,c), (r',c')}` is an edge iff `{|r-r'|, |c-c'|} = {1, 2}` — i.e., the two squares are one knight move apart.

Basic structural facts:

- **Degree bound:** every vertex has degree at most 8. Corner squares of a large board have degree 2; edge squares have degree 3 or 4; interior squares can reach 6 or 8.
- **Bipartiteness:** color squares as on a chessboard (`(r+c) mod 2`). Every knight move changes color, so `G` is **bipartite** with the two color classes as parts. This single fact drives the parity arguments below.
- **Sparsity:** `|E| = O(MN)`; the graph is sparse and locally structured, which is exactly what makes degree-based heuristics effective.
- **Connectivity:** for boards large enough to have tours, `G` is connected; small degenerate boards (`2×2`, isolated cases) can be disconnected or have isolated vertices.

The balance of the two color classes matters. On an `M×N` board the number of light and dark squares differs by at most 1, and equals exactly when `MN` is even. Because knight moves alternate colors, any path or cycle alternates parts of the bipartition — the source of the necessary conditions for tours.

### Degree distribution on a standard board

The degree of a vertex in the knight graph is a function of how close the square is to an edge or corner. On an `8×8` board the distribution is instructive:

| Square type | Count on 8×8 | Degree |
|-------------|--------------|--------|
| Corner (4 corners) | 4 | 2 |
| Adjacent-to-corner edge | 8 | 3 |
| Other edge squares | 20 | 4 |
| Near-edge interior | 16 | 6 |
| Deep interior | 16 | 8 |

The sum of degrees is `2|E|`. The preponderance of low-degree squares around the boundary is exactly why a tour must "service" the perimeter carefully — and why Warnsdorff's most-constrained-first strategy is so effective: it prioritizes the corner-and-edge squares that the table shows are the bottleneck.

### The knight graph as a constraint network

It is illuminating to view the tour problem as a **constraint satisfaction problem (CSP)**. The "variables" are the positions in the visiting sequence, the "domain" of each is the set of squares, and the constraints are (a) all-different (a permutation of squares) and (b) consecutive squares are knight-adjacent. Warnsdorff's degree rule is then precisely the **minimum-remaining-values (MRV)** / **most-constrained-variable** heuristic from CSP theory: always branch on the variable with the fewest legal values left. That this classic CSP heuristic is exactly Warnsdorff's 1823 rule is a satisfying convergence of recreational mathematics and modern AI search.

---

## Tours as Hamiltonian Paths and Cycles

Translate the chess language into graph language:

| Chess object | Graph object |
|--------------|--------------|
| Open knight's tour | **Hamiltonian path** in `G` (visit every vertex once). |
| Closed (re-entrant) tour | **Hamiltonian cycle** in `G` (close the path into a cycle). |
| A legal knight move | An edge of `G`. |
| "Visit every square exactly once" | "Visit every vertex exactly once." |

This identification is exact: solving the Knight's Tour *is* finding a Hamiltonian path/cycle in the knight graph. All Hamiltonicity theory applies.

**A formal statement of the equivalence.** Let `G` be the knight graph on an `M×N` board and let `π = (s₀, s₁, …, s_{MN-1})` be a sequence of distinct squares. Then `π` is an **open knight's tour** iff `{s_t, s_{t+1}} ∈ E(G)` for all `0 ≤ t < MN-1` and `{s₀, …, s_{MN-1}} = V(G)` — that is, `π` is a Hamiltonian path in `G`. It is a **closed tour** iff additionally `{s_{MN-1}, s₀} ∈ E(G)`, i.e., a Hamiltonian cycle. This equivalence is what lets us import every Hamiltonicity theorem (and every hardness result) wholesale.

**Parity from bipartiteness.** In a bipartite graph with parts `X` (light) and `Y` (dark):

- A **Hamiltonian path** alternates `X, Y, X, Y, …`. With `|X| = a`, `|Y| = b`, a Hamiltonian path can exist only if `|a − b| ≤ 1`.
- A **Hamiltonian cycle** has equal numbers of `X` and `Y` vertices, so it requires `a = b`, i.e., the two color classes are **equal in size**.

For an `M×N` board, `a = b` exactly when `MN` is even. Hence:

> **A closed knight's tour requires `MN` even.** Equivalently, a board with an odd number of squares (e.g., any odd×odd board) has **no** closed tour.

This is a *necessary* condition, proved purely from bipartite structure; Schwenk's theorem pins down exactly when it (and the other obstructions) is also *sufficient*.

---

## NP-Hardness in General

The **Hamiltonian path** and **Hamiltonian cycle** decision problems are **NP-complete** for general graphs (Karp, 1972). The corresponding search problems are NP-hard. Since a knight's tour is a Hamiltonian path/cycle in the knight graph, the *general* "does a Hamiltonian path exist in this graph?" question that backtracking solves is NP-hard.

Two important nuances:

1. **The knight graph is a restricted family.** NP-hardness of Hamiltonicity is about *arbitrary* graphs. Restricted to the very structured knight graphs, the existence question is actually **decidable in `O(1)`** via Schwenk's theorem (you check a finite condition on `M, N`), and a tour can be **constructed in `O(MN)`**. So "NP-hard in general" coexists with "easy for knights".
2. **The hardness still bites the *algorithm*.** A generic backtracking Hamiltonian-path search does not know the structure and explores an exponential tree. That is why naive backtracking is exponential even though a clever constructive method is linear.

The lesson: NP-hardness is a statement about a *problem class*, not a license to give up on a *structured instance*. Knight's Tour is the textbook example.

### Worked existence decisions

Applying the theorems to a handful of boards, step by step:

- **`8×8` (standard chessboard).**
  - Open tour: `N = 8 ≥ 5` ⇒ exists.
  - Closed tour: not both odd, `M ∉ {1,2,4}`, not the `3×{4,6,8}` case ⇒ exists.
- **`5×5`.**
  - Open tour: `N = 5 ≥ 5` ⇒ exists.
  - Closed tour: both dimensions odd ⇒ odd area ⇒ **none**.
- **`4×4`.**
  - Open tour: in the forbidden `M=4, N=4` case ⇒ **none**.
  - Closed tour: `M = 4` ⇒ **none**.
- **`3×7`.**
  - Open tour: `M=3` and `N=7 ∉ {3,5,6}` ⇒ exists.
  - Closed tour: both odd ⇒ **none**.
- **`6×6`.**
  - Open tour: `N = 6 ≥ 5` ⇒ exists.
  - Closed tour: `M = 6`, none of the obstructions ⇒ exists.

This mechanical decision procedure is exactly what the `O(1)` predicates in the code section implement.

### Reduction intuition

To see why Hamiltonicity is NP-complete, recall Karp's reduction chain: `3-SAT ≤ₚ Vertex Cover ≤ₚ Hamiltonian Cycle`. The gadgets used in those reductions are arbitrary graphs with carefully engineered degree patterns — nothing like the rigid, planar-ish, degree-≤-8 grid structure of the knight graph. The knight graph simply cannot encode an arbitrary SAT instance, which is informally why its Hamiltonicity is tractable while the general problem is not. Formally, the tractability is established directly by the constructive theorems below, not by any structural-hardness dichotomy.

### Parameterized and grid perspectives

Hamiltonian path remains NP-complete even when restricted to **grid graphs** (Itai, Papadimitriou, Szeider, 1982) — graphs whose vertices are lattice points and whose edges connect unit-distance neighbors. The knight graph is *not* a grid graph (its edges are knight moves, not unit steps), and crucially it is far more regular, which is what tips it from hard to easy. This contrast — Hamiltonicity hard on grid graphs but easy on knight graphs — underscores that "lives on a board" is not what makes a problem easy; the specific adjacency structure is.

---

## Schwenk's Theorem (Closed Tours)

The definitive existence result for **closed** tours on rectangular boards:

> **Schwenk's Theorem (1991).** An `M × N` board with `M ≤ N` has a **closed** knight's tour **unless** one or more of the following holds:
> 1. `M` and `N` are **both odd** (then `MN` is odd → fails the parity/bipartite condition);
> 2. `M ∈ {1, 2, 4}`;
> 3. `M = 3` and `N ∈ {4, 6, 8}`.
> In all other cases a closed tour exists.

Reading the three obstructions:

- **(1) Both odd.** `MN` odd ⇒ unequal color classes ⇒ no Hamiltonian cycle in a bipartite graph. (The parity argument above.)
- **(2) `M ∈ {1, 2, 4}`.** `M = 1` or `M = 2`: the board is too thin; the knight cannot maneuver to form a cycle. `M = 4`: a subtler coloring argument (a second auxiliary 2-coloring) shows the would-be cycle is forced into a structure that cannot close — `4×N` boards never have a closed tour, for any `N`.
- **(3) `M = 3`, `N ∈ {4, 6, 8}`.** A handful of small exceptions that fail by case analysis; for `N ≥ 10` (and `N` even, since `3·N` must be even) the `3×N` board *does* admit a closed tour.

Consequences worth memorizing:
- The standard `8×8` board **has** closed tours (none of the obstructions apply).
- Every odd×odd board (`5×5`, `7×7`, …) has **no** closed tour.
- No `4×N` board ever has a closed tour.

### Sketch of the `4×N` obstruction

The `M = 4` case is the most surprising, since `4×N` boards have even area for even `N`, so the simple parity argument does not rule them out. The obstruction uses a **second coloring** in addition to the chessboard one. Partition the four rows into two outer rows `{0, 3}` (call them class `A`) and two inner rows `{1, 2}` (class `B`). One checks that on a `4×N` board, every knight move from an `A` square lands on a `B` square — but the converse is *not* forced, so a `B` square can move to either class. Counting moves in a hypothetical Hamiltonian cycle, the cycle would have to alternate in a way the two colorings jointly forbid; combining the chessboard coloring with the `A/B` coloring yields a contradiction. This double-counting argument is the heart of Schwenk's proof for `M = 4`. The takeaway for engineers: never assume even area is sufficient; the exact theorem matters.

Schwenk's theorem is remarkable for being a **complete** characterization: a finite list of forbidden shapes, everything else allowed. Contrast this with general Hamiltonicity, where no such clean characterization exists (and cannot, unless P = NP). The knight graph's regularity is precisely what makes a finite obstruction list possible — a recurring theme in this topic.

### Practical existence lookup

For an implementation, encode Schwenk's predicate as the `O(1)` function shown in the code section. A complete decision table for small `M` (with `M ≤ N`):

| M | Closed tour exists when |
|---|--------------------------|
| 1 | never |
| 2 | never |
| 3 | `N` even and `N ≥ 10` |
| 4 | never |
| 5 | `N` even (so `MN` even) and `N ≥ 6` |
| 6 | `N ≥ 5` (i.e., almost always) |
| ≥6 | unless both `M,N` odd |

(The `M=5` row reflects that `5×5`, `5×7`, … are odd-area and excluded; `5×6`, `5×8`, … work.)

---

## Open-Tour Existence

Open tours (Hamiltonian *paths*) are easier to obtain than closed tours; the necessary parity condition is the weaker `|a − b| ≤ 1`, satisfied by every board. The classification (for `M ≤ N`):

> An `M × N` board has an **open** knight's tour **iff none** of these holds:
> - `M = 1` (except the trivial `1×1`) or `M = 2`;
> - `M = 3` and `N ∈ {3, 5, 6}`;
> - `M = 4` and `N = 4`.

For square boards this collapses to the familiar statement:

> **An `N×N` board has an open knight's tour for every `N ≥ 5`**, and has none for `N ∈ {2, 3, 4}` (`1×1` is the trivial tour).

So `5×5` has an open tour (but, being odd-area, no closed tour); `8×8` has both.

---

## Warnsdorff as a Greedy Heuristic

Warnsdorff's rule is a **greedy algorithm**: at each step it makes the locally optimal choice (move to the unvisited square of minimum degree) without lookahead or backtracking. Frame it in the standard greedy template:

- **Candidate set:** legal unvisited moves from the current square.
- **Selection function:** minimize `degree(candidate)` (unvisited onward moves), with a tie-break.
- **Feasibility:** the chosen square must be unvisited and on-board.
- **Objective:** complete a Hamiltonian path.

A greedy algorithm is **provably optimal** only when the problem exhibits a *matroid* structure or an *exchange argument* applies (see sibling `14-greedy-algorithms`). The Hamiltonian-path objective has neither: there is no matroid whose bases are tours, and no exchange argument shows a minimum-degree choice is always extendable. So we should *expect* Warnsdorff to lack a guarantee — its success is an empirical property of the knight graph's geometry, not a consequence of greedy-optimality theory.

**Why it usually works (heuristic justification).** Degrees are *monotonically non-increasing* as the tour progresses (each visit removes a vertex from every neighbor's count). A vertex of small degree is at risk of reaching degree 0 while still unvisited — which strands it and dooms the tour. Greedily consuming minimum-degree vertices first is a "most-constrained-variable" strategy (the same heuristic used in constraint satisfaction): handle the fragile choices while you still can. This keeps the residual graph as "flexible" as possible.

**Why it carries no guarantee.** Greedy choices are local; a sequence of locally optimal moves can still walk into a globally unavoidable dead end. There is **no proof** that minimum-degree selection always extends to a full tour. Its excellent empirical success rate (with good tie-breaking, near 100% on standard boards) is exactly that — empirical — not a theorem. This is the canonical example of a heuristic that is **fast and usually right but not provably correct**, motivating the backtracking fallback in any robust implementation.

---

## Counterexamples to Pure Warnsdorff

Pure Warnsdorff (greedy, no backtracking) provably fails on some boards and starts:

- **Tie-break sensitivity.** When several candidates share the minimum degree, the *choice among ties* can determine success. There exist boards where one tie-break completes a tour and another dead-ends. This is why "Warnsdorff fails" is usually really "Warnsdorff with a bad tie-break fails".
- **Documented failing boards.** For larger boards, instances are known where, for certain start squares, the naive minimum-degree rule (with simple tie-breaking) gets stuck before completing. Researchers report that pure Warnsdorff's success rate, while very high on `8×8`, **degrades** as board size grows and depends on the tie-break and start square.

**A concrete tie-break failure scenario.** Consider a partial tour where the knight stands on a square with two legal moves of equal degree. One leads into a region of the board that still contains a "bridge" square (an articulation point of the residual knight graph) which, if not crossed at the right moment, splits the unvisited region into two components — after which no Hamiltonian path can cover both. A degree-only rule sees the two candidates as identical and may pick the one that strands a component; a center-distance or lookahead tie-break can distinguish them. This shows that the *failures of pure Warnsdorff are essentially connectivity failures*: the greedy rule does not track whether the residual graph stays Hamiltonian-connected.

**Articulation points and the residual graph.** After each move, the unvisited squares induce a subgraph `G'`. A necessary condition for completion is that `G'` admits a Hamiltonian path with the correct endpoints. Tracking the full Hamiltonian-connectivity of `G'` is itself NP-hard, so no efficient *complete* local rule can exist. Warnsdorff approximates this by the cheap proxy "fewest onward moves"; lookahead variants approximate it a little better — but the gap between the cheap proxy and the true (intractable) condition is exactly where failures live.
- **Closed tours.** Warnsdorff has no mechanism to ensure the final square is adjacent to the start, so it is unreliable for closed tours even when one exists.

The practical upshot, restated as theory: minimum-degree greedy is **incomplete**. Robustness requires either (a) a proven constructive method, or (b) greedy ordering wrapped in complete backtracking.

### Empirical success and its decay

Studies of pure Warnsdorff (with simple tie-breaking) report success rates that are extremely high on `8×8` but **decline as `N` grows**, with the decline strongly dependent on the tie-break and the starting square. Squirrel and Cull, and later Pohl, showed that adding a one-ply lookahead tie-break (when degrees tie, compare the *next* level's minimum degree) dramatically raises the success rate and keeps it high to much larger `N`. Even so, no tie-break rule has ever been proven to make greedy complete for all `N` — the question of whether a polynomial-time *purely greedy* rule solves all boards remains, for practical purposes, answered only empirically. This is why the engineering recommendation is unambiguous: order with Warnsdorff, but never remove the backtracking safety net unless you are using a *proven* constructive algorithm.

---

## Complexity of Naive Backtracking

Model naive backtracking as DFS over the search tree whose nodes are partial tours and whose branching factor is the number of legal unvisited moves (≤ 8), with maximum depth `MN`.

- **Worst-case time:** `O(8^(MN))` — exponential. Concretely, the number of leaves is bounded by the product of branching factors along root-to-leaf paths; with branching up to 8 over depth `MN`, this is exponential in the number of squares.
- **A tighter but still exponential bound** uses the actual degrees: the branching at a node is the residual degree of the current vertex, so the tree size is bounded by the product of residual degrees — still exponential because most of the tree consists of failing partial tours.
- **Space:** `O(MN)` for the board plus `O(MN)` recursion depth.
- **Why it fails late:** the obstruction (a stranded vertex) is often invisible until deep in the recursion, so the search performs `Θ(MN)` work down a doomed branch before backtracking — repeated exponentially many times.
- **Comparison to brute-force permutation enumeration:** naively enumerating all `(MN)!` orderings and testing each is vastly worse than backtracking, because backtracking prunes any ordering the moment two consecutive squares are not knight-adjacent. Backtracking is therefore an *exponential improvement* over permutation enumeration, even before Warnsdorff ordering — but still exponential.

Warnsdorff ordering does not change the worst-case bound; it changes the *expected* behavior by making the first explored branch almost always succeed, collapsing the effective tree to `O(MN)` visited nodes. The gap between `O(8^(MN))` worst case and `O(MN)` typical case is the entire story of why the heuristic matters.

### Pruning bounds and forced moves

Two cheap prunes provably cut the tree without losing completeness:

1. **Dead-square detection.** After each move, if any *unvisited* square (other than the immediate next target) has degree 0, no tour can complete through this partial state — prune immediately. This is sound because a degree-0 unvisited square can never be entered again.
2. **Forced-move propagation.** If exactly one unvisited square has degree 1, the knight must visit it before it becomes degree 0; you can follow forced moves deterministically, shrinking the branching factor. If two distinct degree-1 squares appear that cannot both be serviced, prune.

These prunes (a form of constraint propagation) reduce the *effective* branching factor substantially. They do not improve the asymptotic worst case but make even adversarial instances far more tractable, complementing the Warnsdorff ordering.

### Why the worst case is rarely observed

The exponential worst case requires the search to repeatedly descend deep doomed branches. Warnsdorff ordering biases the *first* descent toward success, and the dead-square prune cuts doomed branches near their root rather than their leaves. The product of these two effects is that, for the knight graph specifically, the observed running time clusters tightly around `O(MN)` even though the proven bound remains exponential. This is the classic situation where average-case (or "typical-instance") behavior diverges enormously from the worst-case bound.

---

## Constructive Methods and Linear-Time Tours

Because the knight graph is so structured, tours can be **constructed** without search:

- **Divide-and-conquer (quadrant stitching).** Split the board into quadrants, build a closed tour on each recursively, then splice the four cycles into one by exchanging a constant number of edges across the seams. This yields **`O(MN)`** tours and underlies Parberry's algorithm, which produces closed tours on `n×n` boards for even `n ≥ 6` (and open tours more generally) in linear time, and even **divide-and-conquer in parallel**.
- **Explicit modular constructions.** For specific board families there are closed-form patterns (e.g., concatenating small base-case tiles) that emit a tour directly.

These constructive results are *constructive proofs* of the existence theorems: they not only assert a tour exists but produce one in linear time. They are the theoretical reason the "NP-hard in general" label does not make large knight boards intractable.

### Parberry's algorithm in more detail

Parberry (1997) gave a divide-and-conquer algorithm that computes a closed knight's tour on any `n×n` board (`n` even, `n ≥ 6`) in time linear in the number of squares, and showed it parallelizes well. The structure:

- **Base cases.** Hand-construct (or precompute by search) *structured* closed tours for the smallest boards `6×6`, `8×8`, `10×10`, `12×12`. "Structured" means the tour contains specific edges near each corner that the merge step relies on.
- **Recursive split.** For `n > 12`, divide the `n×n` board into four `(n/2)×(n/2)` quadrants and recursively obtain structured tours on each.
- **Merge.** Each quadrant tour is a cycle. The algorithm deletes one designated edge in each quadrant cycle (chosen near the shared internal corner) and adds four knight edges crossing the quadrant boundaries, splicing the four cycles into one Hamiltonian cycle on the whole board. The "structured" property guarantees the needed boundary-crossing edges exist.
- **Rectangles.** The technique extends to `M×N` boards by handling non-square remainders with precomputed strip tours.

Correctness follows by induction: if each quadrant's structured invariant holds, the merge produces a single cycle with the structured invariant at the next scale. The time recurrence `T(n) = 4·T(n/2) + O(n)` (the merge touches `O(n)` boundary squares) solves to `T(n) = O(n²)` — linear in the `n²` squares.

### The merge invariant, stated precisely

The reason base cases must be "structured" is subtle and worth stating. Define a tour as *structured* if it uses a fixed pair of knight edges in each corner region — specifically edges that can be deleted and replaced by boundary-crossing edges during a merge. The induction hypothesis is: *every recursively produced quadrant tour is structured.* The merge then (a) consumes one structured edge per quadrant, (b) adds four cross-boundary edges, and (c) re-establishes the structured property for the combined `n×n` tour so the next level up can recurse. Without the invariant, a merge might find no compatible boundary edges and fail. Verifying the invariant for the four base cases (`6,8,10,12`) is the one piece of finite case-checking the whole linear-time guarantee rests on.

### Other constructions

- **Backtracking-free heuristic-only** generation works in practice for open tours with a good tie-break, but, lacking a proof, is not a *constructive theorem*.
- **Neural-network / collective-computation** methods (Takefuji & Lee) historically produced tours but offer no complexity guarantee and are mainly of historical interest.
- **Transfer-matrix / decomposition** methods are used for *counting* rather than constructing single tours.

---

## Counting Results

Beyond existence, one can ask **how many** tours a board has:

- **`8×8` closed (directed) tours:** there are exactly **26,534,728,821,064** directed closed tours on the `8×8` board (counting a tour and its reverse as distinct, and rotations/reflections as distinct). The number of *undirected* closed tours is half of that. These counts were obtained by large-scale computation (Löbbing & Wegener and later corrections).
- **Open tours** are far more numerous and harder to count exactly for `8×8`; counts are known for smaller boards by exhaustive search.
- **Counting is hard in general.** Counting Hamiltonian paths/cycles is **#P-complete**, so exact counts for large boards are obtained by specialized methods (e.g., binary decision diagrams, transfer matrices), not naive enumeration.

For small boards, exhaustive backtracking that counts (rather than stops at the first) solution is the practical tool — see the interview file's "count tours on a small board" challenge.

### Small-board counts (open tours, directed, by start)

Exhaustive search yields exact figures for small boards. A few reference values:

| Board | Quantity |
|-------|----------|
| `5×5` open tours (total, all starts, directed) | 1728 |
| `5×5` open tours starting from a corner | 304 |
| `6×6` open tours (total) | tens of thousands (computed by exhaustive search) |
| `8×8` closed tours (directed) | 26,534,728,821,064 |
| `8×8` closed tours (undirected) | 13,267,364,410,532 |

These make excellent **regression-test fixtures**: a counting implementation can assert the `5×5` corner count of `304` to detect off-by-one or visited-tracking bugs. (Exact totals vary by convention — whether reflections, rotations, and reversals are identified — so always fix a convention before asserting a number.)

How these counts are obtained, by board size:

- **`5×5`, `6×6`:** plain exhaustive backtracking counts every tour in seconds.
- **`7×7`:** still feasible with pruning (dead-square detection) in minutes.
- **`8×8` open:** too many for naive enumeration; specialized decomposition or BDD methods are required.
- **`8×8` closed:** the famous count came from a binary-decision-diagram computation, not enumeration.

The jump from "enumerate them all" to "count without enumerating" between `7×7` and `8×8` is itself a vivid illustration of the combinatorial explosion that makes counting #P-complete in general.

### Why counting is harder than finding

Finding *one* tour is easy here (construction, or Warnsdorff), but **counting all** tours is #P-complete even though a single witness is cheap. This mirrors the general gap between NP (find a witness) and #P (count all witnesses):

- **Decision/search:** "Does a tour exist? Produce one." — easy for knight graphs.
- **Counting:** "How many tours are there?" — #P-complete; no known polynomial method even when finding one is trivial.

The lesson is that tractability of the search version says nothing about the counting version. Real systems that need counts on non-trivial boards rely on transfer-matrix or decision-diagram techniques, never naive enumeration, and even those are exponential in the smaller board dimension.

### Heuristic variants compared

The literature offers several refinements of Warnsdorff's base rule. Listed from simplest to most robust:

- **Plain Warnsdorff (min degree, arbitrary ties).**
  - Selection: minimum onward degree.
  - Tie-break: first-found in move-offset order.
  - Strength: trivial to implement.
  - Weakness: highest failure rate; fails on many large boards.
- **Warnsdorff + center-distance tie-break.**
  - Selection: minimum onward degree.
  - Tie-break: prefer the candidate farthest from the board center.
  - Strength: removes most edge-stranding failures.
  - Weakness: still no completeness proof.
- **Pohl / one-ply lookahead (the "Roth" rule).**
  - Selection: minimum onward degree.
  - Tie-break: among ties, recurse one level — pick the candidate whose own minimum-degree neighbor is smallest.
  - Strength: empirically near-100% success to large `N`.
  - Weakness: more expensive per step (still `O(1)` amortized, larger constant).
- **Warnsdorff ordering + full backtracking.**
  - Selection/tie-break: any of the above for ordering.
  - Fallback: undo and try the next candidate on failure.
  - Strength: **complete** — always finds a tour if one exists.
  - Weakness: exponential worst case (essentially never hit on knight graphs).
- **Divide-and-conquer construction.**
  - Not a search at all; builds the tour directly.
  - Strength: provably `O(MN)`, no failure possible on supported boards.
  - Weakness: limited to board families with worked-out base cases.

The engineering default for general boards is "Warnsdorff + center-distance tie-break + backtracking fallback"; for very large structured boards, the constructive method wins outright.

### Symmetry and equivalence classes

Tours come in symmetry classes under the board's dihedral group `D₄` (4 rotations × 2 reflections = 8 symmetries) and, for directed counts, the reversal that swaps start and end. When a problem asks for "distinct" tours, clarify whether it means:

- **directed, all positions distinct** (largest count),
- **undirected** (identify a tour with its reverse: divide by 2 for tours that are not their own reverse),
- **up to board symmetry** (quotient by `D₄`, using Burnside's lemma to handle tours fixed by some symmetry).

Conflating these conventions is the most common source of "wrong" counting answers, more than algorithmic bugs.

---

## Code Examples

### Bipartite color-class check (necessary condition for a closed tour)

A quick `O(1)` test of the parity necessary condition, plus an `O(1)` Schwenk closed-tour existence predicate.

#### Go

```go
package main

import "fmt"

// Necessary condition for a closed tour: equal color classes <=> M*N even.
func closedParityOK(m, n int) bool { return (m*n)%2 == 0 }

// Schwenk's theorem: closed tour exists iff NONE of the obstructions hold.
func closedTourExists(m, n int) bool {
	if m > n {
		m, n = n, m // assume m <= n
	}
	if m%2 == 1 && n%2 == 1 {
		return false // both odd
	}
	if m == 1 || m == 2 || m == 4 {
		return false
	}
	if m == 3 && (n == 4 || n == 6 || n == 8) {
		return false
	}
	return true
}

func main() {
	fmt.Println("8x8 closed:", closedTourExists(8, 8)) // true
	fmt.Println("5x5 closed:", closedTourExists(5, 5)) // false (both odd)
	fmt.Println("4x6 closed:", closedTourExists(4, 6)) // false (m=4)
	fmt.Println("parity 8x8:", closedParityOK(8, 8))   // true
}
```

#### Java

```java
public class Existence {
    static boolean closedParityOK(int m, int n) { return (m * n) % 2 == 0; }

    static boolean closedTourExists(int m, int n) {
        if (m > n) { int t = m; m = n; n = t; }
        if (m % 2 == 1 && n % 2 == 1) return false;     // both odd
        if (m == 1 || m == 2 || m == 4) return false;
        if (m == 3 && (n == 4 || n == 6 || n == 8)) return false;
        return true;
    }

    public static void main(String[] args) {
        System.out.println("8x8 closed: " + closedTourExists(8, 8)); // true
        System.out.println("5x5 closed: " + closedTourExists(5, 5)); // false
        System.out.println("4x6 closed: " + closedTourExists(4, 6)); // false
        System.out.println("parity 8x8: " + closedParityOK(8, 8));   // true
    }
}
```

#### Python

```python
def closed_parity_ok(m, n):
    """Necessary condition for a closed tour: equal color classes <=> m*n even."""
    return (m * n) % 2 == 0


def closed_tour_exists(m, n):
    """Schwenk's theorem: closed tour exists iff none of the obstructions hold."""
    if m > n:
        m, n = n, m  # assume m <= n
    if m % 2 == 1 and n % 2 == 1:
        return False        # both odd -> odd area -> bipartite imbalance
    if m in (1, 2, 4):
        return False
    if m == 3 and n in (4, 6, 8):
        return False
    return True


if __name__ == "__main__":
    print("8x8 closed:", closed_tour_exists(8, 8))  # True
    print("5x5 closed:", closed_tour_exists(5, 5))  # False
    print("4x6 closed:", closed_tour_exists(4, 6))  # False
    print("parity 8x8:", closed_parity_ok(8, 8))    # True
```

**What it does:** encodes the bipartite parity necessary condition and Schwenk's complete closed-tour existence predicate as `O(1)` checks.

---

## Spectral and Algebraic Notes

The adjacency matrix `A` of the knight graph carries useful global information:

- **Walk counting.** `(A^k)[i][j]` counts knight *walks* (repeats allowed) of length `k` between squares `i` and `j` — the matrix-exponentiation fact from sibling topic `11-graphs/32-paths-fixed-length`. This counts walks, **not** tours (Hamiltonian paths), so it does not directly solve the tour problem, but it is the right tool for "how many length-`k` knight routes" questions.
- **Closed walks and the trace.** `trace(A^k) = Σ_i (A^k)[i][i]` counts closed knight walks of length `k`; this equals `Σ λᵢ^k` over the eigenvalues `λᵢ` of `A`. Because `A` is symmetric (the knight graph is undirected), all eigenvalues are real.
- **Bipartite spectrum.** Since the knight graph is bipartite, its spectrum is symmetric about 0: if `λ` is an eigenvalue, so is `−λ`. This is a direct algebraic consequence of the chessboard 2-coloring.

None of this gives a polynomial algorithm for the tour itself (Hamiltonicity is not visible in the spectrum), but the spectral viewpoint connects the knight graph to the broader algebraic-graph-theory toolkit and explains the parity structure from a second angle.

A short checklist of algebraic facts about the knight graph `A`:

- `A` is symmetric ⇒ real eigenvalues, orthogonal eigenvectors.
- Bipartite ⇒ spectrum symmetric about 0 (`λ` ⇒ `−λ`).
- `Σ λᵢ = trace(A) = 0` (no self-loops: a knight cannot stay put).
- `Σ λᵢ² = trace(A²) = 2|E|` = twice the number of knight edges.
- `Σ λᵢ³ = trace(A³) = 6·(number of triangles)` = 0, because the bipartite knight graph has **no odd cycles**, hence no triangles.
- Largest eigenvalue `λ_max ≤ 8` (max degree), approached only on large boards where most squares have degree 8.

These identities are useful sanity checks when computing with the adjacency matrix and reinforce the bipartite/parity structure algebraically.

## Relationship to Other Hard Problems

The Knight's Tour is one node in a web of related computational problems, useful to keep straight:

| Problem | Relationship | Tractability |
|---------|--------------|--------------|
| Hamiltonian path/cycle (general) | Tour is a special instance | NP-complete |
| Hamiltonian path on grid graphs | Different adjacency; harder | NP-complete |
| Knight's tour (open/closed) | This topic | `O(1)` existence, `O(MN)` construction |
| Traveling Salesman (TSP) | Hamiltonian cycle + weights | NP-hard |
| Counting Hamiltonian paths | "How many tours?" | #P-complete |
| Longest path | Tour maximizes visited squares | NP-hard |

The pattern: the *decision/optimization* versions are intractable in general, but the **structured** knight instance is fully solved by special-purpose theorems and constructions. This is the headline theoretical message of the topic.

---

## Summary

The Knight's Tour is, formally, a search for a **Hamiltonian path** (open tour) or **Hamiltonian cycle** (closed tour) in the **knight graph** — a bipartite, sparse, degree-≤-8 graph. Because Hamiltonicity is **NP-complete** for general graphs, the generic search problem is NP-hard, which is why naive backtracking runs in `O(8^(MN))` worst case. But the knight graph's structure rescues us: **Schwenk's theorem** gives an exact `O(1)` test for closed-tour existence (no tour iff both dimensions odd, or `M ∈ {1,2,4}`, or `M=3` with `N ∈ {4,6,8}`), the bipartite coloring proves a closed tour needs an even number of squares, open tours exist for all `N ≥ 5`, and **divide-and-conquer constructions** produce tours in `O(MN)`. **Warnsdorff's rule** is a greedy minimum-degree (most-constrained-first) heuristic: monotonic degrees explain why it usually works, but it has **no completeness guarantee** and demonstrable failures (tie-break sensitive, weak for closed tours), which is precisely why robust solvers pair it with backtracking. Counting tours is **#P-complete**, yet exact figures are known for small boards (the `8×8` has 26,534,728,821,064 directed closed tours). The Knight's Tour thus serves as a compact tour through Hamiltonicity, complexity, exact existence theory, and the analysis of greedy heuristics.

---

## Further Reading

- A. J. Schwenk, "Which Rectangular Chessboards Have a Knight's Tour?", *Mathematics Magazine* (1991) — the closed-tour existence theorem.
- I. Parberry, "An Efficient Algorithm for the Knight's Tour Problem", *Discrete Applied Mathematics* (1997) — linear-time divide-and-conquer construction.
- M. Löbbing and I. Wegener, "The Number of Knight's Tours Equals 33,439,123,484,294 — Counting with Binary Decision Diagrams" (1996), with later corrections giving the accepted closed-tour count.
- R. M. Karp, "Reducibility Among Combinatorial Problems" (1972) — NP-completeness of Hamiltonian cycle.
- A. Itai, C. Papadimitriou, J. Szeider, "Hamilton Paths in Grid Graphs" (1982) — hardness on grid graphs.
- *Across the Board: The Mathematics of Chessboard Problems* (J. J. Watkins) — comprehensive treatment of tours and existence.
- Sibling topic `11-graphs/32-paths-fixed-length` — adjacency-matrix walk counting and spectra.
- Sibling topic `14-greedy-algorithms` — greedy heuristics and their (lack of) guarantees.
