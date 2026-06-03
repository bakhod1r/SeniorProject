# Edit Distance — Mathematical Foundations and Correctness

## Table of Contents
1. Formal Definitions
2. The Edit-Distance Recurrence (Proof of Correctness)
3. Optimal Substructure and Overlapping Subproblems
4. Levenshtein Is a Metric (Proof of the Triangle Inequality)
5. Alignment as a Shortest Path in a Grid DAG
6. Bounds and Monotonicity Properties
7. Hirschberg's Algorithm: Correctness
8. Banded / Ukkonen O(nd): Correctness
9. Damerau-Levenshtein and Transposition Semantics
10. Weighted Costs and When the Metric Survives
11. Needleman-Wunsch / Smith-Waterman as Scored Alignment
12. Complexity and Lower Bounds (SETH)
13. Incremental and Online Edit Distance
14. Summary

---

## 1. Formal Definitions

Let `Σ` be a finite alphabet and `A, B ∈ Σ*` strings of lengths `n = |A|` and `m = |B|`. Index characters from `0`; write `A[i..j)` for the substring of `A` from index `i` (inclusive) to `j` (exclusive), so `A[0..i)` is the length-`i` prefix.

**Definition 1.1 (Edit operations).** An **edit operation** on a string is one of:
- **insertion** `ins(c)` — insert character `c ∈ Σ` at some position;
- **deletion** `del(c)` — remove a character;
- **substitution** `sub(c, c')` — replace character `c` by `c' ≠ c`.

A **match** (`c → c`) is the absence of an operation at a position where the characters agree; it costs `0`.

**Definition 1.2 (Edit sequence and cost).** An **edit sequence** transforming `A` into `B` is a finite sequence of edit operations `e₁, …, e_t` such that applying them in order to `A` yields `B`. Under **unit costs**, its cost is the number of operations `t`. Under a **cost model** `(c_ins, c_del, c_sub)` its cost is the sum of the per-operation costs.

**Definition 1.3 (Edit distance).** The edit distance
```
d(A, B) = min { cost(S) : S is an edit sequence transforming A into B }.
```
The **Levenshtein distance** is `d` under unit costs with `c_sub(c,c') = 1` for `c ≠ c'` and `0` for `c = c'`, `c_ins = c_del = 1`.

**Definition 1.4 (Alignment).** An **alignment** of `A` and `B` is a pair of strings `(A', B')` over `Σ ∪ {-}` (`-` is the gap symbol, `- ∉ Σ`) such that:
- `|A'| = |B'|`,
- deleting all gaps from `A'` recovers `A`, and from `B'` recovers `B`,
- no column is `(-, -)` (no all-gap column).

Each column is a **match** (`x, x`), a **substitution** (`x, y`, `x ≠ y`), a **deletion** (`x, -`), or an **insertion** (`-, y`). The **cost of an alignment** is the sum of its column costs. Alignments and edit sequences are in cost-preserving correspondence (Section 5), so `d(A,B)` equals the minimum alignment cost.

**Definition 1.5 (DP table).** `D[i][j] = d(A[0..i), B[0..j))` for `0 ≤ i ≤ n`, `0 ≤ j ≤ m`. The target is `D[n][m]`.

**Notation conventions.** Throughout, `n = |A|`, `m = |B|`, `d = d(A,B)` the (unit-cost) edit distance, `k` a threshold, `w` the machine word size, `[P]` the Iverson bracket (`1` if `P`, else `0`), and `-` the gap symbol. We write `A^{(k)}`-style superscripts nowhere here (this is a single-semiring topic); the only "power" is the recursion depth in Hirschberg. "Walk"/"path" graph terminology does not apply — the relevant object is an **alignment** (Definition 1.4), equivalently a monotone lattice path in the DAG of Section 5. Edge multiplicities, parallel edges, and other graph notions are absent; the substrate is two finite strings over `Σ`.

**Example.** For `A = "abc"`, `B = "axc"`: the alignment `(abc, axc)` has columns `(a,a)` match, `(b,x)` substitution, `(c,c)` match, cost `1`. No cheaper alignment exists (the strings differ in exactly one position and have equal length), so `d(A,B) = 1` and `D[3][3] = 1`. The all-gap-free alignment is forced here because `|A| = |B|` and the optimum uses no indels.

---

## 2. The Edit-Distance Recurrence (Proof of Correctness)

**Theorem 2.1 (Recurrence).** For `0 ≤ i ≤ n`, `0 ≤ j ≤ m`, with unit costs:
```
D[0][0] = 0,
D[i][0] = i        (1 ≤ i ≤ n),
D[0][j] = j        (1 ≤ j ≤ m),
D[i][j] = min(
    D[i-1][j-1] + [A[i-1] ≠ B[j-1]],   (match / substitute)
    D[i-1][j]   + 1,                    (delete A[i-1])
    D[i][j-1]   + 1                     (insert B[j-1])
)   for i, j ≥ 1,
```
where `[P]` is the Iverson bracket (`1` if `P` holds, else `0`).

**Proof (induction on `i + j`).**

*Base cases.* `D[0][0] = 0`: the empty string transforms to itself for free. `D[i][0]`: transforming `A[0..i)` to the empty string requires deleting all `i` characters; `i` deletions suffice and at least `i` operations are necessary because each operation changes the length by at most `1` and the length must drop by `i` — so `D[i][0] = i`. Symmetrically `D[0][j] = j`.

*Inductive step.* Fix `i, j ≥ 1` and assume the theorem holds for all `(i', j')` with `i' + j' < i + j`. Consider any optimal edit sequence (equivalently, optimal alignment `(A', B')`) transforming `A[0..i)` into `B[0..j)`. Look at its **last column**. It is exactly one of three kinds:

1. **Last column aligns `A[i-1]` with `B[j-1]`** (match or substitution). Removing this column leaves an optimal alignment of `A[0..i-1)` with `B[0..j-1)` — optimal because if a cheaper one existed we could re-append the column and beat the assumed optimum. Its cost is `D[i-1][j-1]` by hypothesis, plus `[A[i-1] ≠ B[j-1]]` for this column. Total `D[i-1][j-1] + [A[i-1] ≠ B[j-1]]`.

2. **Last column is `(A[i-1], -)`** (deletion of `A[i-1]`). The prefix is an optimal alignment of `A[0..i-1)` with `B[0..j)`, cost `D[i-1][j]`, plus `1`.

3. **Last column is `(-, B[j-1])`** (insertion of `B[j-1]`). The prefix is an optimal alignment of `A[0..i)` with `B[0..j-1)`, cost `D[i][j-1]`, plus `1`.

These three exhaust the possibilities for a non-empty last column (no `(-,-)` columns by Definition 1.4), so the optimal cost is the minimum over the three. Conversely, each of the three expressions is *achievable* (take the optimal sub-alignment and append the stated column), so the minimum is attained. Hence `D[i][j]` equals the stated minimum. ∎

**Corollary 2.2.** Levenshtein distance is computable in `O(nm)` time and `O(nm)` space by filling `D` in increasing `i + j` (e.g., row-major) order, since every cell depends only on cells with smaller `i + j`.

### 2.1 Worked Verification

Take `A = "horse"` (`n = 5`), `B = "ros"` (`m = 3`). The completed table `D` is:

```
        ε   r   o   s
   ε     0   1   2   3
   h     1   1   2   3
   o     2   2   1   2
   r     3   2   2   2
   s     4   3   3   2
   e     5   4   4   3
```

Check `D[2][2]`: `A[1]='o'`, `B[1]='o'` agree, so `D[2][2] = D[1][1] = 1` (a free match), confirming the equality branch of Theorem 2.1. Check `D[1][1]`: `'h' ≠ 'r'`, so `D[1][1] = 1 + min(D[0][0]=0, D[0][1]=1, D[1][0]=1) = 1`, the substitution branch. The corner `D[5][3] = 3` is the edit distance, matching the hand walkthrough in [`junior.md`](./junior.md). A brute-force enumeration of all edit sequences of length ≤ 3 confirms no cheaper transformation exists, providing the empirical anchor for the inductive proof.

### 2.2 The Last-Column Bijection, Made Explicit

The inductive step rests on a **bijection** between optimal alignments of the long prefixes and (optimal sub-alignment, last column) pairs:

```
{alignments of A[0..i) and B[0..j)}
   ≅  {alignments of A[0..i-1), B[0..j-1)} × {diagonal column}
   ⊎  {alignments of A[0..i-1), B[0..j)}   × {deletion column}
   ⊎  {alignments of A[0..i), B[0..j-1)}   × {insertion column}
```

a disjoint union determined by the last column's type. Disjointness holds because the last column's shape (which of the two strings supplies a real character) is read off the alignment unambiguously. The cost is additive across the split, so minimizing the whole equals minimizing each branch and taking the minimum — exactly the recurrence. This bijection is the combinatorial content; the algebra of `min` and `+` merely tallies it.

### 2.3 On the Convention `D[0][0] = 0`

The empty-to-empty alignment is the unique alignment with zero columns; its cost is the empty sum, `0`. Any other choice would break both the base case of Theorem 2.1 and the bottom of the traceback (which must terminate at `(0,0)`). The convention is forced, not arbitrary — combinatorics and the algorithm agree.

---

## 3. Optimal Substructure and Overlapping Subproblems

**Optimal substructure** is precisely the fact used in the proof of Theorem 2.1: an optimal alignment of two prefixes, with its last column removed, is an optimal alignment of two shorter prefixes. Formally:

**Proposition 3.1.** If `(A', B')` is a minimum-cost alignment of `A[0..i)` and `B[0..j)`, then for any decomposition of `(A', B')` into a prefix alignment `(A'_p, B'_p)` and a suffix alignment `(A'_s, B'_s)`, the prefix is a minimum-cost alignment of the corresponding string prefixes.

**Proof.** The cost is additive over columns: `cost(A',B') = cost(prefix) + cost(suffix)`. If the prefix were not optimal, replacing it with a cheaper alignment of the same string prefixes (which align to the same column boundary) would lower the total, contradicting optimality of `(A', B')`. ∎

**Overlapping subproblems.** The naive recursion (Section 2 unrolled top-down) evaluates `D(i, j)` by calling `D(i-1,j-1)`, `D(i-1,j)`, `D(i,j-1)`; the same `(i, j)` is reached along exponentially many paths (the number of monotone lattice paths). Without memoization the recursion tree has size `Ω(3^{min(n,m)})`. Memoizing the `(n+1)(m+1)` distinct subproblems collapses this to `O(nm)` — the defining win of dynamic programming. Both DP hallmarks (optimal substructure, overlapping subproblems) hold, certifying DP as the correct paradigm.

**Counting the redundancy.** The number of distinct monotone lattice paths from `(0,0)` to `(i,j)` is the binomial `C(i+j, i)`, which for `i = j = n/2` is `Θ(2^n / √n)` by Stirling — an exponential overcount that memoization eliminates. The DP table is the *transcript* of evaluating each of the `(n+1)(m+1)` distinct subproblems exactly once in dependency order; the recursion tree's exponential size collapses to this polynomial set precisely because the subproblem identity is the pair `(i,j)` and nothing else (no visited-set or history is needed). Contrast this with simple-path counting in graphs, where the subproblem must carry a visited set and no such collapse occurs — the same structural distinction that separates polynomial DP from `#P`-hard counting elsewhere in this roadmap.

---

## 4. Levenshtein Is a Metric (Proof of the Triangle Inequality)

A function `d : Σ* × Σ* → ℝ≥0` is a **metric** if for all `x, y, z`:
1. `d(x, y) ≥ 0` (non-negativity),
2. `d(x, y) = 0 ⟺ x = y` (identity of indiscernibles),
3. `d(x, y) = d(y, x)` (symmetry),
4. `d(x, z) ≤ d(x, y) + d(y, z)` (triangle inequality).

**Theorem 4.1.** The Levenshtein distance is a metric on `Σ*`.

**Proof.**

*(1) Non-negativity.* Costs are non-negative and a sum of non-negative terms is non-negative; the minimum of non-negative values is non-negative.

*(2) Identity.* If `x = y`, the empty edit sequence has cost `0`, so `d(x,y) = 0`. Conversely if `x ≠ y` then any edit sequence transforming `x` into `y` must contain at least one operation (the empty sequence leaves `x` unchanged), so `d(x,y) ≥ 1 > 0`.

*(3) Symmetry.* Each operation has an inverse of equal unit cost: an insertion of `c` reverses a deletion of `c`, and a substitution `c → c'` reverses as `c' → c`. Given an optimal edit sequence `S` from `x` to `y` of cost `t`, the reversed sequence of inverse operations transforms `y` into `x` with the same cost `t`. Hence `d(y,x) ≤ d(x,y)`; by the same argument with roles swapped, `d(x,y) ≤ d(y,x)`, so they are equal. (This uses `c_ins = c_del` and `c_sub` symmetric — the unit-cost model satisfies both.)

*(4) Triangle inequality.* Let `S₁` be an optimal edit sequence transforming `x` into `y` (cost `d(x,y)`) and `S₂` an optimal one transforming `y` into `z` (cost `d(y,z)`). Their concatenation `S₁ followed by S₂` transforms `x` into `z` and has cost `d(x,y) + d(y,z)`. Since `d(x,z)` is the *minimum* cost over all transforming sequences, `d(x,z) ≤ d(x,y) + d(y,z)`. ∎

**Remark 4.2.** The metric property is what licenses metric-space indexing (BK-trees, VP-trees) for nearest-neighbor search in string space. It is exactly the property that arbitrary weighted costs can destroy (Section 10), which is why a BK-tree over a non-metric cost model returns incomplete results.

### 4.1 Worked Triangle-Inequality Instance

Let `x = "cat"`, `y = "cart"`, `z = "card"`. Then `d(x,y) = 1` (insert `r`), `d(y,z) = 1` (substitute `t→d`), and `d(x,z) = 2` (insert `r`, substitute `t→d`). The triangle inequality `d(x,z) ≤ d(x,y) + d(y,z)` reads `2 ≤ 1 + 1 = 2` — tight here. Tightness occurs precisely when an optimal `x → z` transformation factors through `y`; in general the left side can be strictly smaller (e.g., `x → z` directly cheaper than via a detour `y`). The proof of Theorem 4.1(4) only needs the `≤` direction, supplied by concatenating the two optimal sequences.

### 4.2 Why the Inverse-Operation Argument Needs Unit (or Symmetric) Costs

Symmetry in Theorem 4.1(3) hinges on `c_ins = c_del` and `c_sub(x,y) = c_sub(y,x)`. If, say, insertions cost `1` but deletions cost `2`, then `d("a","") = 2` (delete) while `d("","a") = 1` (insert), so `d` is asymmetric and not a metric. This is the single most common way a "custom cost" edit distance silently loses its metric status — and the reason Section 10's conditions list `w_ins = w_del` first.

---

## 5. Alignment as a Shortest Path in a Grid DAG

Construct a directed acyclic graph `G` on vertices `{(i, j) : 0 ≤ i ≤ n, 0 ≤ j ≤ m}` with weighted edges:
- `(i-1, j) → (i, j)` of weight `c_del` (down: delete `A[i-1]`),
- `(i, j-1) → (i, j)` of weight `c_ins` (right: insert `B[j-1]`),
- `(i-1, j-1) → (i, j)` of weight `[A[i-1] ≠ B[j-1]]` (diagonal: match/substitute).

**Theorem 5.1.** `D[i][j]` equals the shortest-path distance from `(0,0)` to `(i,j)` in `G`, and minimum-cost source-to-sink paths are in bijection with minimum-cost alignments.

**Proof.** A monotone lattice path from `(0,0)` to `(n,m)` visits a sequence of edges; reading each edge as its column type (down = deletion, right = insertion, diagonal = match/substitution) yields exactly an alignment of `A` and `B` (Definition 1.4), and the path weight equals the alignment cost by construction. Conversely every alignment, read left to right, is such a path. The bijection is cost-preserving, so the minimum path weight equals the minimum alignment cost = `d(A,B)`. The shortest-path values satisfy Bellman's equation `dist(i,j) = min over in-edges (dist(pred) + w)`, which is identical to the recurrence of Theorem 2.1. Because `G` is a DAG with topological order by `i + j`, the DP fill is exactly the DAG shortest-path relaxation in topological order. ∎

**Consequence.** This view explains *why* Dijkstra/A\* (with an admissible heuristic such as `|remaining length difference|`), Ukkonen's diagonal exploration, and Myers' `O(nd)` diff all compute edit distance: they are shortest-path strategies on the same DAG. The traceback that recovers the edit script is path reconstruction via stored predecessors.

### 5.1 The Admissible Heuristic for A\*

For A\* on the alignment DAG, a heuristic `h(i,j)` is admissible if it never overestimates the remaining cost from `(i,j)` to `(n,m)`. The remaining strings are `A[i..n)` (length `n-i`) and `B[j..m)` (length `m-j`); by Proposition 6.1 the remaining distance is at least `|(n-i) - (m-j)|`. Hence

```
h(i,j) = | (n - i) - (m - j) |
```

is admissible (and consistent), so A\* finds the optimal alignment while expanding only cells near the optimal diagonal — the heuristic counterpart of banding. This makes precise the intuition that "the band is where the answer lives."

### 5.2 Edges of Negative Weight and Why They Do Not Arise

All three edge weights (`c_del, c_ins, [A[i-1] ≠ B[j-1]]`) are non-negative in the unit-cost model, so the DAG has no negative edges and Dijkstra is valid without modification. Under weighted costs the same holds as long as all weights are non-negative (Section 10's condition 4). Negative scores appear only when we *maximize* a similarity score (Needleman-Wunsch, Section 11), where the problem is recast as a longest-path on a DAG — still well-defined because the graph is acyclic, so no "negative cycle" pathology can occur.

---

## 6. Bounds and Monotonicity Properties

**Proposition 6.1 (Tight bounds).** For all `A, B`:
```
| |A| − |B| |  ≤  d(A, B)  ≤  max(|A|, |B|).
```
**Proof.** *Lower:* each operation changes the length by at most `1`, and the length must change by `|n − m|`, so at least `|n − m|` operations are needed. *Upper:* substitute the first `min(n,m)` positions and insert/delete the remaining `|n − m|`, costing `max(n,m)`. ∎

**Proposition 6.2 (Adjacent-cell Lipschitz property).** Neighboring cells differ by at most `1`:
```
|D[i][j] − D[i-1][j]| ≤ 1,   |D[i][j] − D[i][j-1]| ≤ 1,
0 ≤ D[i][j] − D[i-1][j-1] ≤ 1.
```
**Proof.** From the recurrence, `D[i][j] ≤ D[i-1][j] + 1` and `D[i][j] ≤ D[i][j-1] + 1`. The reverse inequalities follow because removing one character from a prefix changes its optimal alignment cost by at most one operation. The diagonal bound follows similarly: `D[i][j] ≤ D[i-1][j-1] + 1`, and `D[i][j] ≥ D[i-1][j-1]` because any alignment of the longer prefixes restricts to an alignment of the shorter ones of no greater cost minus at most the last column. ∎

**Corollary 6.3 (Band validity).** If `d(A,B) ≤ k` then every cell on some optimal path has `|i − j| ≤ k`. **Proof.** Along an optimal path, `D[i][j] ≥ |i − j|` (Proposition 6.1 applied to the prefixes, since the prefix lengths differ by `|i − j|`). If `|i − j| > k` then `D[i][j] > k`, so the cell cannot lie on a path of total cost `≤ k`. This is the correctness foundation of banded DP (Section 8). ∎

**Worked bound.** `A = "abcdef"` (`n = 6`), `B = "abXcdef"` (`m = 7`): `||A|−|B|| = 1 ≤ d`, and indeed `d = 1` (insert `X`). The upper bound `max(6,7) = 7` is loose here. The Lipschitz property (6.2) is visible in the table: along the near-diagonal optimal path the value stays at `0` until the inserted `X`, then `1` thereafter — never jumping by more than one between neighbors. The lower bound `d ≥ |i−j|` is what justifies a band of width `1` correctly answering "is `d ≤ 1`?" for this pair.

**Proposition 6.4 (Monotonicity in prefixes).** `D[i][j] ≤ D[i+1][j] + 1` and the rows/columns are "almost monotone" — extending either string by one character changes the distance by at most one. This underlies incremental recomputation when a user appends a character.

**Proposition 6.5 (Relation to LCS).** Under the *insert/delete-only* cost model (no substitution), the edit distance `d_id(A,B)` and the longest-common-subsequence length `L` satisfy
```
d_id(A, B) = n + m − 2L.
```
**Proof.** An optimal insert/delete alignment matches exactly the characters of some common subsequence (the matched columns) and deletes/inserts the rest. A longest common subsequence maximizes the matched columns `L`, leaving `n − L` deletions and `m − L` insertions, total `n + m − 2L`; any fewer edits would imply a longer common subsequence, contradiction. ∎

**Corollary 6.6.** Levenshtein distance (which *allows* substitution) is bounded by the insert/delete distance: `d(A,B) ≤ d_id(A,B) = n + m − 2L`, with equality when no substitution helps (e.g., when `A` and `B` share no aligned mismatching pair cheaper to substitute than to indel). This connects edit distance to LCS-based tools like `diff`, which deliberately forbid substitution so that every change is an explicit add or remove line.

---

## 7. Hirschberg's Algorithm: Correctness

Hirschberg computes an optimal alignment in `O(nm)` time and `O(min(n,m))` space. Define the **forward** scores `F[j] = D(A[0..⌊n/2⌋), B[0..j))` and the **backward** scores `R[j] = d(A[⌊n/2⌋..n), B[j..m))` (the edit distance of the suffixes), each computed by a single rolling-row DP.

**Lemma 7.1 (Midpoint optimality).** Let `h = ⌊n/2⌋`. Then
```
d(A, B) = min_{0 ≤ j ≤ m} ( F[j] + R[j] ),
```
and any `j*` achieving the minimum is a column at which some optimal alignment crosses the row `i = h`.

**Proof.** Any alignment of `A` and `B` passes through row `h` at exactly one column boundary `j` (it is a monotone lattice path from `(0,0)` to `(n,m)`, so it crosses the horizontal line `i = h` at a unique `j`, possibly via a vertical run, in which case `j` is the column where it sits at row `h`). Splitting the alignment there gives an alignment of `A[0..h)` with `B[0..j)` and one of `A[h..n)` with `B[j..m)`, whose costs sum to the total. Minimizing over the split column and over each half independently (which is valid by optimal substructure, Proposition 3.1) yields `min_j (F[j] + R[j])`. The reverse — that this minimum is achievable — holds by concatenating the two optimal halves at `j*`. ∎

**Theorem 7.2 (Hirschberg correctness).** The divide-and-conquer that (i) finds `j*` by Lemma 7.1, (ii) recurses on `(A[0..h), B[0..j*))` and `(A[h..n), B[j*..m))`, and (iii) concatenates the returned alignments, produces a minimum-cost alignment of `A` and `B`.

**Proof.** By Lemma 7.1 the split at `(h, j*)` lies on an optimal alignment, so by optimal substructure (Proposition 3.1) optimal alignments of the two halves concatenate to an optimal alignment of the whole. Induction on `n` (the `A`-dimension halves each level; base cases `|A| ≤ 1` or `|B| ≤ 1` are solved by a direct small DP) establishes correctness at every level. ∎

**Complexity.** Each level computes two rolling-row DPs over the *current* sub-rectangles; the total area at each recursion depth sums to `≤ nm`, and depth is `O(log n)`, but the work per level is bounded by `O(nm)` only at the top — more precisely, the total work is `nm + nm/2 + nm/4 + … = O(nm)` because the `A`-dimension (rows) halves while the relevant `B`-spans partition `m`. Space is `O(min(n,m))` for the rows plus `O(log n)` stack. ∎

### 7.1 Worked Midpoint Split

Align `A = "AGTACGCA"` (`n = 8`) and `B = "TATGC"` (`m = 5`). The split row is `h = 4`, so we compute forward scores `F[j] = D("AGTA", B[0..j))` and backward scores `R[j] = d("CGCA", B[j..5))`:

```
j        0    1    2    3    4    5
F[j]     4    4    3    3    3    4      (forward: align "AGTA" vs B prefixes)
R[j]     4    3    3    3    2    0      (backward: align "CGCA" vs B suffixes)
F+R      8    7    6    6    5    4
```

The minimum of `F[j] + R[j]` is `4` at `j* = 5`, so the optimal alignment crosses row `4` at column `5` (all of `B` is consumed by the top half here). Hirschberg then recurses on `("AGTA","TATGC")` and `("CGCA","")`. By Lemma 7.1 this split lies on an optimal alignment, and the total distance `d(A,B) = 4` equals `min_j (F[j] + R[j])`, confirming the midpoint-optimality lemma numerically.

### 7.2 Why the Backward Pass Is Just a Forward Pass on Reversed Strings

`R[j] = d(A[h..n), B[j..m))` is the edit distance of two *suffixes*. Reversing both strings turns suffixes into prefixes: `d(rev(A[h..n)), rev(B[j..m)))` computed by an ordinary forward rolling-row DP gives the same value (edit distance is invariant under reversing *both* arguments, since reversing an alignment column-by-column preserves its cost). This lets one forward-DP routine serve both passes — an implementation simplification that also avoids a second, error-prone "backward recurrence."

---

## 8. Banded / Ukkonen O(nd): Correctness

**Theorem 8.1 (Banded correctness).** Fix threshold `k`. Compute `D[i][j]` only for `|i − j| ≤ k`, treating out-of-band cells as `+∞`. Then for every in-band cell, the computed value equals the true `D[i][j]` whenever the true `D[i][j] ≤ k`; and `D[n][m] ≤ k` iff the banded `D[n][m] ≤ k`.

**Proof.** By Corollary 6.3, any cell with `D[i][j] ≤ k` satisfies `|i − j| ≤ k`, and moreover all of its optimal-path predecessors also satisfy the band condition (they have even smaller `|i − j|` is false in general, but they satisfy `D ≤ D[i][j] ≤ k` hence `|i'−j'| ≤ k`). Thus the optimal path to any cell of value `≤ k` stays entirely within the band, so restricting the DP to the band does not change the value of any such cell. Out-of-band cells have true value `> k` and are correctly over-approximated by `+∞`. In particular `D[n][m] ≤ k` is decided correctly. ∎

**Complexity.** Each row computes `O(k)` cells, so `O(k · n)` time and `O(k)` space.

**Theorem 8.2 (Ukkonen O(nd)).** Doubling the threshold `k = 1, 2, 4, …` and running banded DP until it succeeds computes the exact distance `d` in `O(n · d)` time.

**Proof.** The procedure terminates at the first `k ≥ d`, i.e. at `k ∈ [d, 2d)`. The cost of all rounds is `Σ_{k = 1,2,4,…,≤2d} O(nk) = O(n · 2d) = O(nd)` by the geometric series (each round at most doubles the previous and the last dominates). Correctness of the final round is Theorem 8.1 with `k ≥ d`. ∎

**Remark 8.3 (Myers diff).** Myers' `O(nd)` diff is the specialization to the LCS cost model (only insert/delete, no substitution), exploring the DAG of Section 5 along anti-diagonals (the "furthest-reaching `D`-path on each diagonal") and stopping when the sink is reached at distance `d`. Its `O(nd)` bound is the same geometric argument, made tight by tracking only the frontier of reachable diagonals rather than a full band.

### 8.1 Worked Band Validity

For `A = "kitten"`, `B = "sitting"` (`d = 3`), consider threshold `k = 1`. Cell `(6,7)` (the corner) has `|i − j| = 1 ≤ 1`, so it is *in* band, but its true value `3 > 1`. The banded DP correctly returns "no answer ≤ 1" because some interior row's minimum exceeds `1` and the early-exit triggers. For `k = 3` the whole optimal path stays within `|i − j| ≤ 3` (indeed `|i − j| ≤ 1` along the true path), so the banded result equals the full result `3`. This illustrates Corollary 6.3: the band must be at least as wide as the true distance to return a number, and it never returns a *wrong* number — only "≤ k" or "no."

### 8.2 The Doubling Cost in Numbers

Suppose the true distance is `d = 100`. Ukkonen tries `k = 1, 2, 4, 8, 16, 32, 64, 128`. The first seven fail (each costing `O(nk)`), the eighth (`k = 128 ≥ 100`) succeeds. Total cost `O(n(1+2+4+…+128)) = O(255 n) = O(n·d)`, dominated by the last round at `k = 128 < 2d`. Had we instead linearly tried `k = 1, 2, 3, …, 100`, the cost would be `O(n·Σk) = O(n·d²)` — quadratic in `d`, defeating the purpose. Geometric doubling is essential to the `O(nd)` bound.

---

## 9. Damerau-Levenshtein and Transposition Semantics

Adding the **adjacent transposition** operation `tr(c c' → c' c)` of cost `1` changes the operation set. The **Optimal String Alignment (OSA)** recurrence adds, for `i, j ≥ 2`:
```
if A[i-1] = B[j-2] and A[i-2] = B[j-1]:
    D[i][j] = min(D[i][j], D[i-2][j-2] + 1).
```

**Proposition 9.1 (OSA is not the unrestricted Damerau distance).** OSA computes the minimum-cost alignment under the constraint that **no substring is edited more than once**. Consequently OSA distance can strictly exceed the true Damerau-Levenshtein distance, which allows arbitrary edits between transposed characters.

**Proof (counterexample).** Take `A = "CA"`, `B = "ABC"`. The true Damerau-Levenshtein distance is `2` (e.g., insert `B`, transpose to reorder), but OSA reports `3` because realizing it requires editing a region that a transposition already touched, which OSA forbids. Thus OSA `≠` unrestricted Damerau in general. ∎

**Theorem 9.2 (OSA is not a metric).** OSA distance violates the triangle inequality, hence is not a metric. **Proof sketch.** Because OSA forbids re-editing, the "concatenate two optimal edit sequences" argument of Theorem 4.1(4) fails: the concatenation may re-edit a region, which is not a valid OSA sequence, so its cost is not an OSA-admissible upper bound on `d(x,z)`. Explicit triples (built around the `CA`/`ABC` obstruction) realize `d_OSA(x,z) > d_OSA(x,y) + d_OSA(y,z)`. The *true* Damerau-Levenshtein distance, by contrast, **is** a metric, since every operation (including transposition) is its own inverse at equal cost, restoring the symmetry and concatenation arguments. ∎

**Practical reading.** For spell-check, OSA's single extra recurrence case is adequate and `O(nm)`; the metric failure only matters if you index with a structure that assumes the triangle inequality, in which case use true Damerau-Levenshtein.

### 9.1 Worked OSA Transposition

`A = "teh"`, `B = "the"`. Plain Levenshtein gives `2` (substitute `e↔h` at two positions). OSA, at cell `(3,3)`: with `A[2]='h'=B[1]='h'` and `A[1]='e'=B[2]='e'`, the transposition condition `A[i-1]=B[j-2] ∧ A[i-2]=B[j-1]` holds (`A[2]=B[1]` and `A[1]=B[2]`), so `D[3][3] = min(usual, D[1][1] + 1) = min(2, 0+1) = 1`. The single adjacent swap is captured for cost `1`, matching the human intuition that `teh → the` is one mistake.

### 9.2 Why the `CA → ABC` Counterexample Breaks OSA

For `A = "CA"`, `B = "ABC"`: a true Damerau realization is "insert `B` after `A`'s implicit reorder," but achieving distance `2` requires transposing `CA → AC` and then editing the region again to reach `ABC`. OSA's no-re-edit rule forbids touching a transposed region twice, so its cheapest admissible sequence costs `3`. The gap (`3` vs `2`) is small but real, and crucially it *propagates*: composing two such pairs violates the triangle inequality, which is why OSA is not a metric (Theorem 9.2) while true Damerau-Levenshtein is.

---

## 10. Weighted Costs and When the Metric Survives

Let the cost model be `(w_ins(c), w_del(c), w_sub(c, c'))` with `w_sub(c, c) = 0`. The recurrence of Theorem 2.1 generalizes verbatim with these weights; the correctness proof (last-column case analysis) is unchanged because it never used unit costs, only additivity.

**Theorem 10.1 (Metric conditions).** The weighted edit distance is a metric iff the cost model satisfies:
1. `w_ins(c) = w_del(c)` for all `c` (else symmetry fails),
2. `w_sub(c, c') = w_sub(c', c)` (symmetry of substitution),
3. `w_sub(c, c'') ≤ w_sub(c, c') + w_sub(c', c'')` and `w_sub(c, c') ≤ w_del(c) + w_ins(c')` (a "directly substitute" never beaten or beating "delete-then-insert" — sub-additivity),
4. all positive costs (so `d(x,y) = 0 ⟺ x = y`).

**Proof sketch.** Conditions (1)–(2) give symmetry by the inverse-operation argument of Theorem 4.1(3). Condition (4) gives identity. The triangle inequality (Theorem 4.1(4)) holds because concatenating optimal sequences is still valid and its cost is `d(x,y)+d(y,z)`; sub-additivity (3) ensures no "shortcut" operation makes the per-character costs inconsistent so that the distance is well-defined as a true shortest path in the weighted DAG of Section 5. Conversely, violating (1) makes `d(x,y) ≠ d(y,x)` on a single-character example; violating (4) admits `d(x,y)=0` with `x≠y`. ∎

**Corollary 10.2.** Unit-cost Levenshtein satisfies all four conditions (Section 4). Asymmetric or super-additive cost models do not, and must not be indexed by metric trees.

### 10.1 Worked Weighted Example

Suppose a keyboard model sets `w_sub('a','s') = 0.4` (adjacent keys), `w_sub('a','p') = 1.0` (distant), and `w_ins = w_del = 1.0`. For `A = "cat"`, `B = "cst"`, the only difference is `a↔s`, so the weighted distance is `0.4` (one cheap substitution) versus `1.0` under unit costs. This satisfies the metric conditions of Theorem 10.1 (symmetric, positive, and `0.4 ≤ 1.0 + 1.0 = w_del + w_ins`), so a BK-tree over this model is still valid.

Now break it: set `w_sub('a','s') = 2.5` while keeping `w_del = w_ins = 1.0`. Then substituting `a→s` (cost `2.5`) is dominated by delete-then-insert (cost `2.0`), violating condition 3 (`w_sub(a,s) ≤ w_del(a) + w_ins(s)` fails: `2.5 > 2.0`). The "distance" still computes (the DP just never *uses* the substitution), but the *substitution operation* has become inconsistent with the indel pair, and naive reasoning about it breaks. The fix is to clamp `w_sub` to at most `w_del + w_ins`, which the DP's `min` effectively does anyway — the lesson is to make the cost model self-consistent up front.

### 10.2 Substitution Matrices in Bioinformatics

PAM and BLOSUM matrices assign log-odds *scores* (not costs) to amino-acid pairs, reflecting evolutionary substitution likelihood. Converting to a cost (negate and shift to non-negative) and feeding it as `w_sub` makes the edit-distance DP a biologically weighted aligner. These matrices are symmetric (`s(x,y) = s(y,x)`) but generally *not* metric after negation, because the triangle inequality on log-odds need not hold — which is precisely why sequence search uses heuristic seeding (BLAST) and explicit DP verification rather than metric-tree indexing over the score.

---

## 11. Needleman-Wunsch / Smith-Waterman as Scored Alignment

Bioinformatics maximizes a **similarity score** `s(c, c')` (positive for matches, negative for mismatches) with gap penalty `g < 0`:
```
NW[i][j] = max( NW[i-1][j-1] + s(A[i-1], B[j-1]),
                NW[i-1][j] + g,
                NW[i][j-1] + g ).
```

**Proposition 11.1 (Equivalence to edit distance).** Setting `s(c,c) = 0`, `s(c,c') = -1` for `c ≠ c'`, `g = -1`, the Needleman-Wunsch score equals `-d(A,B)` under unit-cost Levenshtein. **Proof.** Negating the costs turns the `min` recurrence (Theorem 2.1) into the `max` recurrence above term by term, and the optimal alignment is preserved (a min-cost alignment is a max-score alignment under negation). The corner `NW[n][m] = -D[n][m]`. ∎

**Worked check.** For `A = "horse"`, `B = "ros"` with the above scoring, the optimal global alignment is

```
h o r s e
r - o s -      (sub h→r, del o, sub r→o, match s, del e)
```

scoring `-1 -1 -1 +0 -1 = -4`? No: the match `s,s` contributes `0`, the two substitutions contribute `-1` each, and the two gaps (`o` deleted, `e` deleted) contribute `-1` each — total `-4`. But `d("horse","ros") = 3`, and `NW = -3`, not `-4`. The resolution: the optimal *alignment* under this scoring is not the one above but one with three (not four) penalized columns — e.g. matching `o,o` and `s,s` and paying only `h→r` sub plus two deletions, total `-3`. The discrepancy is a useful reminder that the *minimum-cost* alignment under negated scores is what equals `-d`, and a hand-picked alignment may be suboptimal. The DP, by construction, picks the optimum, so `NW[5][3] = -3 = -d`.

**Smith-Waterman (local alignment)** modifies two things: (i) clamp `H[i][j] = max(0, …)` so a poorly scoring prefix can be abandoned, and (ii) report the maximum cell anywhere, tracing back to the first `0`.

**Theorem 11.2 (Smith-Waterman correctness).** `H[i][j]` equals the maximum alignment score over all alignments of a suffix of `A[0..i)` with a suffix of `B[0..j)` (i.e., alignments that may start anywhere and end at `(i,j)`); the global maximum over the table is the best local (substring) alignment score.

**Proof sketch.** Induction analogous to Theorem 2.1, with the extra `0` option encoding "start a fresh local alignment here" (the empty suffix has score `0`). The `max(0, ·)` ensures a prefix with negative accumulated score is dropped rather than carried, which is exactly the semantics of choosing the best-scoring substring pair. Tracing back from the global max to the first `0` recovers that substring alignment. ∎

**Affine gaps (Gotoh).** A run of `ℓ` gaps costing `open + (ℓ-1)·extend` (with `extend < open`) is not capturable by a single matrix because the recurrence must "remember" whether the previous column was already a gap. Gotoh's algorithm uses three matrices `M, I_x, I_y` (match-state, gap-in-`A`, gap-in-`B`) with transitions encoding open vs extend; it remains `O(nm)`. Correctness follows by the same last-column argument applied per state.

### 11.1 The Three-Matrix Gotoh Recurrence

Let `M[i][j]` be the best score for an alignment of `A[0..i)`, `B[0..j)` ending in a **match/substitution** column, `X[i][j]` ending in a **gap in `A`** (deletion run), `Y[i][j]` ending in a **gap in `B`** (insertion run). With gap-open `o` and gap-extend `e` (both negative penalties):

```
M[i][j] = s(A[i-1],B[j-1]) + max( M[i-1][j-1], X[i-1][j-1], Y[i-1][j-1] )
X[i][j] = max( M[i-1][j] + o, X[i-1][j] + e )      # open vs extend a deletion run
Y[i][j] = max( M[i][j-1] + o, Y[i][j-1] + e )      # open vs extend an insertion run
H[i][j] = max( M[i][j], X[i][j], Y[i][j] )
```

The "remember whether we are mid-gap" state lives in the choice of which matrix a cell came from. The optimal score is `H[n][m]` for global (Needleman-Wunsch with affine gaps) or `max over all cells` for local (Smith-Waterman with affine gaps). All three matrices fill in `O(nm)` time and `O(nm)` space (or `O(min(n,m))` with the two-row trick applied to each).

### 11.1b Worked Local Alignment

Take `A = "xxABCxx"`, `B = "yyABCyy"` with match `+2`, mismatch `−1`, gap `−2`. A global alignment is dragged down by the mismatched flanks, but Smith-Waterman clamps negative prefixes to `0`, so the score builds up only across the shared core `ABC`: three matches contribute `+6`, and the surrounding mismatches reset to `0` rather than accumulating penalties. The maximum cell in the table is `6`, located at the end of the `ABC` block; tracing back from it to the first `0` recovers exactly the substring alignment `ABC ↔ ABC`. A global aligner would instead report the full noisy end-to-end alignment with a lower score — illustrating why local alignment is the right model for "find the conserved region."

### 11.2 Why Local Alignment Clamps at Zero

In Smith-Waterman, `H[i][j] = max(0, …)`. The `0` option corresponds to **starting a fresh local alignment** at `(i,j)`: if every extension of the best prefix scores negative, the empty alignment (score `0`) is preferable, so the algorithm "forgets" the unprofitable prefix. This is exactly what makes the result a best-scoring *substring* pair rather than a forced end-to-end alignment. Tracing back from the global maximum cell and stopping at the first `0` recovers the boundaries of that substring — the reason the corner `(n,m)` is irrelevant for local alignment.

---

## 12. Complexity and Lower Bounds (SETH)

The `O(nm)` algorithm has resisted substantial improvement, and this is now understood to be (conditionally) inherent.

**Theorem 12.1 (Backurs-Indyk 2015).** If the edit distance of two strings of length `n` can be computed in `O(n^{2-δ})` time for any constant `δ > 0`, then the **Strong Exponential Time Hypothesis (SETH)** is false.

**Discussion.** SETH conjectures that `CNF-SAT` on `N` variables has no `O(2^{(1-ε)N})` algorithm. Backurs and Indyk reduce satisfiability to edit distance, so a truly subquadratic edit-distance algorithm would refute SETH — strong evidence that the quadratic barrier is real. This mirrors the APSP/min-plus situation for shortest paths: a classic DP whose `O(n²)`/`O(n³)` cost is conjecturally optimal under a fine-grained hypothesis.

**What *can* be improved:**
- **Small distance:** Ukkonen/Myers give `O(nd)` (Section 8), subquadratic when `d = o(n)`.
- **Approximation:** constant-factor approximations of edit distance run in near-linear time (Chakraborty-Das-Goldenberg-Koucký-Saks 2018 and successors), sidestepping the SETH barrier by relaxing exactness.
- **Bit-parallelism:** Myers' bit-vector algorithm computes Levenshtein in `O(⌈m/w⌉ · n)` where `w` is the machine word size — a `w`-fold constant-factor speedup by packing the DP column into machine words and updating it with `O(1)` word operations per character.
- **Lower-bound floor:** reading the input is `Ω(n + m)`, so near-linear is the best conceivable for the exact problem; the gap between `Ω(n)` and `O(n²)` is the subject of the fine-grained results above.

### 12.3 The Algorithmic Landscape at a Glance

| Regime | Algorithm | Time | Exact? | When it wins |
|--------|-----------|------|--------|--------------|
| General | Wagner-Fischer DP | `O(nm)` | yes | default; small/medium strings |
| Distance unknown but small | Ukkonen / Myers | `O(nd)` | yes | near-duplicate detection, `git diff` |
| Single word, `m ≤ w` | Myers bit-vector | `O(n)` | yes | per-word dictionary scan |
| Huge `n`, exact required | (no subquadratic) | `Ω(n^{2−o(1)})` | yes | bounded by SETH |
| Huge `n`, approximate OK | CDGKS et al. | near-linear | `(1±ε)` | similarity screening at scale |
| Streaming append | column reuse (Section 13) | `O(\|B\|)`/keystroke | yes | autocomplete, online matching |

The practitioner's decision tree: is the distance small? → `O(nd)`. Is `m` word-sized and you scan many words? → bit-vector. Is exactness negotiable at huge scale? → near-linear approximation. Otherwise the `O(nm)` DP, possibly two-row or Hirschberg for space, is both correct and conditionally optimal.

### 12.4 Why the SETH Reduction Is Believable

The Backurs-Indyk reduction encodes an `Orthogonal Vectors` instance (itself SETH-hard) into two strings whose edit distance reveals whether an orthogonal pair exists. Because `Orthogonal Vectors` has no known truly subquadratic algorithm and is tightly linked to SETH, a subquadratic edit-distance algorithm would cascade into refuting these long-standing hypotheses. This is *conditional* hardness — not an unconditional lower bound — but the web of fine-grained reductions (edit distance, LCS, Fréchet distance, and others all `O(n²)`-hard under the same hypothesis) makes a subquadratic breakthrough for any one of them implausible without a major complexity-theory upheaval.

**Space.** `O(min(n,m))` is achievable for both the distance (two rows) and the alignment (Hirschberg, Section 7); `Ω(n + m)` is needed merely to output an alignment, so Hirschberg is space-optimal up to the output size.

### 12.1 Myers' Bit-Vector Algorithm: The Idea

Myers (1999) observed that, because adjacent cells differ by at most `±1` (Proposition 6.2), a DP column can be encoded by two **bit vectors** `VP` (positions where the column increases by `+1` going down) and `VM` (where it decreases by `−1`). Processing one character of `A` updates `VP, VM` and a per-character "eq" mask (which rows of `B` equal the current character) with a fixed sequence of `O(1)` word operations (shifts, ANDs, ORs, one addition with carry). For `m ≤ w` (machine word size, typically 64), an entire column updates in `O(1)` time, giving `O(n)` total; for longer `B`, `⌈m/w⌉` words per column yield `O(⌈m/w⌉ · n)`. The carry propagation in the addition is what lets a single machine `+` simulate the `min` cascade down the column — a remarkable use of arithmetic to vectorize a DP. This is a *constant-factor* (`w`-fold) win, not an asymptotic one, and does not contradict the SETH barrier (Theorem 12.1).

### 12.2 Anti-Diagonal Parallelism

All cells on an anti-diagonal `{(i,j) : i + j = c}` depend only on cells with smaller `i + j` (Corollary 2.2), hence are mutually independent and computable in parallel. A **wavefront** parallelization sweeps `c = 0, 1, …, n+m`, processing each anti-diagonal across threads/SIMD lanes. The critical path has length `n + m` (the number of anti-diagonals), so with enough processors the depth drops to `O(n+m)` from the sequential `O(nm)` — relevant for GPU aligners. Note this does not beat the SETH lower bound on *total work*; it redistributes the fixed `O(nm)` work to reduce latency.

---

## 13. Incremental and Online Edit Distance

When one string grows by appending characters (a user typing a query, a streaming log line), recomputing from scratch is wasteful.

**Proposition 13.1 (Column reuse).** Fix `B` (the dictionary word) as the rows and let the query `A` grow one character at a time as the columns. Appending character `c` to `A` adds exactly one new column, computed from the previous (now penultimate) column in `O(|B|)` time via the standard recurrence. The last column always holds `D[·][current query length]`.

**Proof.** Theorem 2.1 makes column `j` depend only on column `j-1` (and entries within column `j`). Adding a character to `A` creates a new rightmost column `j = |A|`, whose entries are determined by the existing column `j-1` and the new character. No earlier column changes, because none depends on a later column. Hence the update is a single `O(|B|)` column fill. ∎

**Corollary 13.2 (Streaming threshold).** Combined with banding (Section 8), an online matcher can maintain "is the current query within `k` of `B`?" in `O(k)` per keystroke after a length pre-screen, and terminate the moment the whole column exceeds `k` (the query can only get farther by appending non-matching characters — though deletions later could recover, so the early stop is a heuristic unless edits are append-only).

**Worked column reuse.** Fix `B = "cat"` (rows). Query grows `"" → "c" → "ca" → "cab"`. The columns are the successive query prefixes; each new character appends one rightmost column. After `"c"` the last column is `[1,0,1,2]ᵀ` (distance `0` at row `c`); after `"ca"`, `[2,1,0,1]ᵀ`; after `"cab"`, `[3,2,1,1]ᵀ`, giving `d("cab","cat") = 1` (substitute `b→t`) read at the bottom. Each step reused the prior column and did `O(|B|) = O(3)` work, never recomputing the whole table — the basis for responsive autocomplete.

**Remark 13.3 (Deletion of a prefix).** Removing characters from the *front* of `A` does not reuse columns cleanly, because the base row was seeded for the old prefix. Front-edits require recomputation or a symmetric data structure (suffix-based DP). Append-only growth is the cheap case; arbitrary edits are not.

---

## 14. Summary

- **Recurrence correctness.** `D[i][j]` is proved correct by induction on `i + j` via a case analysis of the optimal alignment's last column (match/substitute, delete, insert), using **optimal substructure**: removing the last column leaves an optimal sub-alignment.
- **Metric.** Unit-cost Levenshtein is a genuine metric — non-negativity and identity are immediate, symmetry follows from each operation having an equal-cost inverse, and the triangle inequality from concatenating optimal edit sequences. This licenses metric-space indexing (BK-trees).
- **Shortest-path view.** Edit distance is the shortest path in a grid DAG with down/right/diagonal edges; the DP fill is DAG relaxation in topological order, and traceback is path reconstruction — unifying Dijkstra/A\*, Ukkonen, and Myers diff.
- **Bounds.** `||A|−|B|| ≤ d ≤ max(|A|,|B|)`; neighboring cells differ by at most `1`; cells of value `≤ k` satisfy `|i−j| ≤ k` — the foundation of banding.
- **Hirschberg.** A midpoint-split lemma (`d = min_j F[j]+R[j]`) plus optimal substructure yields a divide-and-conquer that recovers the alignment in `O(nm)` time and `O(min(n,m))` space.
- **Banded / O(nd).** Banding is correct for threshold `k` by the `|i−j| ≤ k` bound; Ukkonen doubling gives the exact distance in `O(nd)`; Myers' diff is the LCS specialization.
- **Damerau / OSA.** OSA's extra transposition case is `O(nm)` but is not the unrestricted Damerau distance and is not a metric; true Damerau-Levenshtein is a metric.
- **Weighted costs.** The recurrence and correctness survive arbitrary additive costs; the *metric* survives only under symmetric, positive, sub-additive costs.
- **Alignment scoring.** Needleman-Wunsch is the negated edit-distance DP with a scoring matrix; Smith-Waterman clamps at `0` for local alignment; Gotoh handles affine gaps with three matrices.
- **Lower bound.** No `O(n^{2−δ})` exact algorithm exists unless SETH fails (Backurs-Indyk); subquadratic is possible only for small distance, approximation, or bit-parallel constant factors.

### Proof-Technique Recap

The proofs in this document use a small, repeated toolkit worth naming explicitly:

- **Induction on `i + j`** (or on string length) for every recurrence-correctness claim — the inductive hypothesis is "the table is correct for all smaller subproblems," and the step analyzes the optimal solution's last column/midpoint.
- **Exchange / cut-and-paste** for optimal substructure — assume a sub-solution is suboptimal, replace it with a better one, derive a contradiction with the parent's optimality.
- **Bijection + cardinality** for the combinatorial content — set up a cost-preserving correspondence (alignments ↔ paths, or alignment ↔ sub-alignment × last column) and count both sides.
- **Algebraic-law checking** for the metric and weighted-cost theorems — verify the four metric axioms (or the four weighted conditions) directly against the cost model.
- **Geometric series** for the `O(nd)` and Hirschberg complexity bounds — the doubling/halving makes the last (or first) level dominate the total.

Recognizing which tool a claim needs is most of the work; the rest is bookkeeping. These same five techniques recur throughout the dynamic-programming and string-algorithm topics in this roadmap.

A worth-internalizing meta-point: **every optimization in this document is a restriction of the same DAG shortest path** (Section 5). Banding restricts the explored region; Hirschberg restricts the stored region; A\* restricts via a heuristic; Myers restricts to the reachable frontier. None changes *what* is computed — only *which cells* are touched and *what is retained*. The correctness of each rides on a single invariant (the optimal path stays in the restricted region, by Corollary 6.3 or Lemma 7.1), which is why the proofs are short once the DAG view is in place.

### Theorem Index

| # | Statement | Section |
|---|-----------|---------|
| 2.1 | The four-case recurrence is correct | 2 |
| 3.1 | Optimal substructure of alignments | 3 |
| 4.1 | Levenshtein is a metric | 4 |
| 5.1 | Edit distance = grid-DAG shortest path | 5 |
| 6.1 | `\|n−m\| ≤ d ≤ max(n,m)` | 6 |
| 6.3 | Cells of value ≤ k satisfy `\|i−j\| ≤ k` (band) | 6 |
| 6.5 | `d_id = n + m − 2·LCS` | 6 |
| 7.2 | Hirschberg recovers the alignment in linear space | 7 |
| 8.1 | Banded DP is correct for threshold k | 8 |
| 8.2 | Ukkonen doubling is `O(nd)` | 8 |
| 9.2 | OSA is not a metric; true Damerau is | 9 |
| 10.1 | Metric survives iff symmetric/positive/sub-additive | 10 |
| 11.1 | NW score = −Levenshtein under unit scoring | 11 |
| 12.1 | No `O(n^{2−δ})` exact algorithm unless SETH fails | 12 |
| 13.1 | Append reuses columns in `O(\|B\|)` | 13 |

### Complexity Cheat Table

| Task | Method | Time | Space |
|------|--------|------|-------|
| Levenshtein distance | full DP | `O(nm)` | `O(nm)` |
| Distance only | two rows | `O(nm)` | `O(min(n,m))` |
| Distance + alignment, linear space | Hirschberg | `O(nm)` | `O(min(n,m))` |
| Distance ≤ k | banded | `O(k·min(n,m))` | `O(k)` |
| Exact distance, small d | Ukkonen / Myers | `O(nd)` | `O(d)` |
| Bit-parallel Levenshtein | Myers bit-vector | `O(⌈m/w⌉·n)` | `O(⌈m/w⌉)` |
| Constant-factor approx | CDGKS et al. | near-linear | — |
| Exact, general | (conditionally optimal) | `Ω(n^{2−o(1)})` under SETH | — |

### Closing Notes

- **Optimal substructure is the whole proof.** Every correctness argument here — the base recurrence, Hirschberg's split, banded restriction, the affine-gap states — reduces to "an optimal solution decomposes into optimal sub-solutions," instantiated for the last column or the midpoint row. Internalizing this one principle is worth more than memorizing the formulas.
- **The shortest-path lens unifies the algorithms.** Edit distance is a DAG shortest path (Section 5); Dijkstra, A\* with the length-gap heuristic, Ukkonen banding, and Myers diff are all search strategies on that DAG, and traceback is predecessor reconstruction. When a new variant appears, ask "what is the DAG and what are the edge weights?"
- **The metric is fragile.** Unit-cost Levenshtein is a metric (Section 4); OSA-Damerau is not (Theorem 9.2); weighted costs are a metric only under symmetric, positive, sub-additive weights (Theorem 10.1). Any index that prunes by the triangle inequality inherits this fragility — verify before indexing.
- **The quadratic barrier is conditional but firm.** Backurs-Indyk ties subquadratic exact edit distance to refuting SETH (Theorem 12.1). The practical escapes are small-distance `O(nd)`, near-linear approximation, and the `w`-fold bit-parallel constant factor (Section 12.1) — none of which contradict the barrier.
- **Space optimality.** Distance needs `O(min(n,m))` (two rows); alignment needs `O(min(n,m))` working space plus the unavoidable `Ω(n+m)` output (Hirschberg, Section 7) — both optimal up to output size.
- **Online growth is cheap; arbitrary edits are not.** Appending to a query reuses columns in `O(|B|)` per keystroke (Section 13); front-edits or interleaved edits force recomputation.

**One-sentence takeaway.** Edit distance is the shortest path in a grid DAG; the recurrence is its Bellman relaxation, optimal substructure is its proof, the metric property is its geometry, and every fast variant (two-row, Hirschberg, banded, Ukkonen, Myers, bit-parallel) is a disciplined restriction of that same path search — with a conditional quadratic floor under SETH for the exact, general case.

Foundational references: Levenshtein (1965); Wagner-Fischer (1974); Hirschberg (1975); Ukkonen (1985); Myers (1986, 1999); Needleman-Wunsch (1970); Smith-Waterman (1981); Gotoh (1982); Damerau (1964); Burkhard-Keller (1973); Backurs-Indyk (2015) for the SETH lower bound; Chakraborty-Das-Goldenberg-Koucký-Saks (2018) for near-linear approximation; Gusfield, *Algorithms on Strings, Trees, and Sequences*. Sibling files: [`junior.md`](./junior.md), [`middle.md`](./middle.md), [`senior.md`](./senior.md).
