# Edit Distance — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Edit Distance Is a Metric (Triangle Inequality Proof)
3. The Recurrence and Its Correctness (Brief)
4. Alignment as a Shortest Path in the Edit Grid
5. The Lipschitz Property of the DP Table (incl. Four-Russians, Space-Time Frontier)
6. Hirschberg's Linear-Space Algorithm: Correctness
7. Ukkonen's O(nd) Diagonal Algorithm: Correctness and Complexity
8. Myers' Bit-Vector Algorithm: Correctness Sketch
9. Damerau-Levenshtein and Weighted Variants
10. The SETH-Based Quadratic Lower Bound (incl. Approximate-Matching Correctness)
11. Relationship to Longest Common Subsequence
11b. Correctness of the Two-Row and Banded Reductions
12. Summary

> **Scope note.** This file establishes *why* the algorithms of the junior/middle/senior files are correct and what their fundamental limits are. The bottom-up DP derivation itself is in `13-dynamic-programming/04-edit-distance`; here we prove the metric properties, the grid-shortest-path equivalence, the linear-space and small-distance and bit-parallel algorithms, the conditional quadratic lower bound, and the LCS relationship — the *theory* that the string-algorithms toolbox rests on.

---

## 1. Formal Definitions

Let `Σ` be a finite alphabet and `A, B ∈ Σ*` strings with `|A| = n`, `|B| = m`.

**Definition 1.1 (Edit operations).** An *edit operation* on a string is one of:
- **insertion** of a symbol `c ∈ Σ` at some position,
- **deletion** of a symbol at some position,
- **substitution** of the symbol at some position by some `c ∈ Σ`.

Each operation has a cost. For **Levenshtein distance** the cost of insertion and deletion is `1`, substitution is `1` (and a "no-op" identity substitution of a symbol by itself is `0`).

**Definition 1.2 (Edit distance).** The edit distance `d(A, B)` is the minimum total cost of a sequence of edit operations transforming `A` into `B`:

```
d(A, B) = min { cost(s) : s is an edit sequence with s(A) = B }.
```

**Definition 1.2b (Edit script).** An *edit script* is an explicit ordered list of operations with positions. Two scripts are *equivalent* if they transform the same input to the same output; the edit distance is the minimum cost over an equivalence class. Distinguishing scripts (sequences with positions) from alignments (column structures) matters because one alignment can correspond to several scripts that apply the same edits in different orders, all of equal cost.

**Definition 1.3 (Alignment).** An *alignment* of `A` and `B` is a pair of strings `(A', B')` over `Σ ∪ {-}` (the gap symbol `-` ∉ `Σ`) such that:
- `A'` is `A` with gaps inserted, `B'` is `B` with gaps inserted,
- `|A'| = |B'|`,
- no column is `(-, -)`.

The cost of an alignment is `Σ_columns col_cost`, where a column `(x, y)` costs `0` if `x = y` (match), `1` if `x, y ∈ Σ` with `x ≠ y` (substitution), and `1` if exactly one of `x, y` is `-` (indel).

**Proposition 1.4 (Alignments ≡ edit sequences).** `d(A, B)` equals the minimum cost over all alignments of `A` and `B`. Each column of an alignment corresponds to one edit (or a free match), and conversely any edit sequence induces an alignment of equal cost. This equivalence is the formal basis of "edit distance = best alignment", and of traceback.

**Notation.** `D[i][j] = d(A[0..i), B[0..j))` is the distance between the length-`i` prefix of `A` and the length-`j` prefix of `B`. `w` denotes machine word width. The Iverson bracket `[P]` is `1` if `P` holds else `0`. We write the substitution-indicator `σ(x,y) = [x ≠ y]`.

**Remark on the alignment/edit-sequence bijection.** Proposition 1.4 deserves a careful statement because it is the foundation of *every* traceback argument. Given an alignment `(A', B')`, read its columns left to right; each non-`(-,-)` column is one operation (or a free match), and applying these operations in order transforms `A` into `B` at cost equal to the alignment cost. Conversely, an edit sequence can always be *normalized* so that operations act on disjoint, left-to-right positions (any two operations on disjoint positions commute, and operations on the same position can be merged), and the normalized sequence reads off as an alignment of equal cost. The normalization step is what makes the correspondence a genuine bijection on *optimal* objects rather than merely an inequality in both directions. This is also why an optimal edit sequence never both inserts and later deletes the same character: such a pair is a cost-2 no-op removable by normalization, contradicting optimality.

**Worked Example 1.5.** For `A = "abc"`, `B = "axc"`, the alignment
```
a b c
a x c   (columns: match, substitute b→x, match)
```
has cost `0 + 1 + 0 = 1`, and the induced edit sequence is the single substitution `b→x` at position 1 — confirming `d("abc","axc") = 1` and the column-to-edit reading.

**Proposition 1.6 (lower and upper bounds).** For all `A, B`: `| |A| − |B| | ≤ d(A,B) ≤ max(|A|, |B|)`. **Proof.** *Lower:* every indel changes the length difference by exactly 1 and substitutions/matches leave it unchanged, so closing a length gap of `||A|−|B||` needs at least that many indels (this is Theorem 11b.3). *Upper:* substitute the first `min(|A|,|B|)` positions and indel the remaining `||A|−|B||`, a valid edit sequence of cost `max(|A|,|B|)`. ∎ These two bounds bracket the distance using only the lengths, giving the `O(1)` prefilter and a sanity range for any computed value.

**Hamming as a special case.** When `|A| = |B|` and indels are disallowed, edit distance reduces to **Hamming distance** `= Σ_i [A[i] ≠ B[i]]`, the count of differing positions. Hamming is a metric on equal-length strings and is the `O(n)` degenerate case of the `O(nm)` DP (only the diagonal of the table is used). It is the relative most often confused with Levenshtein; the distinguishing feature is whether insertions/deletions are permitted.

---

## 2. Edit Distance Is a Metric (Triangle Inequality Proof)

**Theorem 2.1.** Levenshtein distance `d` is a metric on `Σ*`: for all `x, y, z ∈ Σ*`,
1. `d(x, y) ≥ 0`, and `d(x, y) = 0 ⟺ x = y` (identity of indiscernibles),
2. `d(x, y) = d(y, x)` (symmetry),
3. `d(x, z) ≤ d(x, y) + d(y, z)` (triangle inequality).

**Proof of (1).** Costs are non-negative sums, so `d ≥ 0`. If `x = y` the empty edit sequence has cost `0`. Conversely, a cost-`0` edit sequence performs no insert/delete/non-identity-substitute, so it leaves the string unchanged, forcing `x = y`. ∎

**Proof of (2).** Edit operations are invertible with the same cost: an insertion of `c` is undone by a deletion of `c` (cost 1 each), a substitution `a→b` is undone by `b→a` (cost 1 each). Reversing an optimal edit sequence from `x` to `y` yields an edit sequence from `y` to `x` of equal cost, so `d(y, x) ≤ d(x, y)`; by symmetry of the argument, equality holds. ∎

**Proof of (3) — the triangle inequality.** Let `S₁` be an optimal edit sequence transforming `x` into `y`, with `cost(S₁) = d(x, y)`, and `S₂` an optimal edit sequence transforming `y` into `z`, with `cost(S₂) = d(y, z)`. The concatenation `S₂ ∘ S₁` first turns `x` into `y` (via `S₁`), then `y` into `z` (via `S₂`); it is a valid edit sequence transforming `x` into `z`, of cost `cost(S₁) + cost(S₂) = d(x, y) + d(y, z)`. Since `d(x, z)` is the *minimum* cost over all `x→z` edit sequences, it is at most this particular sequence's cost:

```
d(x, z) ≤ cost(S₂ ∘ S₁) = d(x, y) + d(y, z).   ∎
```

**Why concatenation is valid.** The subtlety some proofs gloss over: `S₂` is an edit sequence on `y`, and after `S₁` the working string *is* `y`, so `S₂` applies verbatim. No re-indexing is needed because we apply `S₂` to the actual intermediate string, not to positions of `x`. This is why the argument is purely about composing transformations and needs no assumption about *how* `S₁` and `S₂` interact — they act on the same intermediate object `y` in sequence. The same compositional argument fails for OSA Damerau (Section 9) precisely because OSA forbids certain re-edits, so `S₂ ∘ S₁` may not be a *valid OSA* sequence even when each part is.

**Significance.** The triangle inequality is exactly the property BK-trees exploit (`senior.md` Section 3): any word within `k` of a query `q` lies on a tree edge whose label `d(child, parent)` is in `[d(q,parent) − k, d(q,parent) + k]`, allowing whole subtrees to be pruned. **Metricity is not a curiosity — it is the precondition for metric-space indexing.** Note that some *weighted* variants (asymmetric or non-triangle-satisfying cost tables) are **not** metrics, which is why BK-trees require unit-cost (or otherwise metric) edit distance.

**Corollary 2.2 (BK-tree pruning bound, formal).** Let `q` be a query and `p` a tree node with `d(q, p) = δ`. A candidate word `w` whose distance to `p` is `ℓ = d(w, p)` satisfies `d(q, w) ≥ |δ − ℓ|`. **Proof.** By the triangle inequality applied twice: `d(q, p) ≤ d(q, w) + d(w, p)`, i.e. `δ ≤ d(q,w) + ℓ`, so `d(q,w) ≥ δ − ℓ`; symmetrically `d(w, p) ≤ d(w, q) + d(q, p)`, i.e. `ℓ ≤ d(q,w) + δ`, so `d(q,w) ≥ ℓ − δ`. Combining, `d(q,w) ≥ |δ − ℓ|`. **Consequence:** if `ℓ ∉ [δ − k, δ + k]` then `|δ − ℓ| > k`, hence `d(q,w) > k`, so the entire subtree of children keyed by such `ℓ` can be skipped — exactly the BK-tree pruning rule. ∎

**Worked Example 2.3 (metric triangle check).** Take `x = "cat"`, `y = "cot"`, `z = "cog"`. Then `d(x,y) = 1` (`a→o`), `d(y,z) = 1` (`t→g`), and `d(x,z) = 2` (`a→o`, `t→g`). The triangle inequality holds with equality: `2 = 1 + 1`. Now take `z' = "dog"`: `d(x,z') = 3`, `d(x,y) + d(y,z') = 1 + d("cot","dog")`. Since `d("cot","dog") = 2`, the bound `3 ≤ 1 + 2 = 3` again holds with equality — the path through `y` is an optimal composite, illustrating that the inequality is *tight* exactly when `y` lies on a shortest edit path between `x` and `z'`.

---

## 3. The Recurrence and Its Correctness (Brief)

The standard recurrence (full derivation in sibling `13-dynamic-programming/04-edit-distance`) is, for `i, j ≥ 1`:

```
D[i][0] = i,   D[0][j] = j,
D[i][j] = min( D[i-1][j-1] + σ(A[i-1], B[j-1]),   # substitute / match
               D[i-1][j]   + 1,                    # delete A[i-1]
               D[i][j-1]   + 1 ).                   # insert B[j-1]
```

**Theorem 3.1 (Correctness, brief).** `D[i][j] = d(A[0..i), B[0..j))`.

**Proof sketch (induction on `i + j`).** Base cases: aligning a prefix to the empty string needs exactly that many indels. Inductive step: consider the **last column** of an optimal alignment of the two prefixes. It is one of (a) a match/substitution pairing `A[i-1]` with `B[j-1]`, leaving an optimal alignment of `A[0..i-1)` and `B[0..j-1)`; (b) a deletion of `A[i-1]` (gap in `B`), leaving `A[0..i-1)` vs `B[0..j)`; (c) an insertion of `B[j-1]` (gap in `A`), leaving `A[0..i)` vs `B[0..j-1)`. By optimality the remaining sub-alignment is itself optimal (optimal substructure), so each case equals the corresponding `D[·][·]` plus its column cost, and `D[i][j]` is the minimum. ∎

We do not belabor this here — the DP topic proves it in full. What the *string-algorithms* perspective adds is the **graph reading** of this same recurrence, developed next, which is what licenses Ukkonen and Myers.

**On optimal substructure.** The inductive step's "by optimality the remaining sub-alignment is itself optimal" deserves emphasis because it is the property that fails for *simple-path* problems (cf. the walks-vs-simple-paths gap in graph topics) but holds cleanly here: an alignment of prefixes decomposes into a last column plus an alignment of shorter prefixes, and the two parts are *independent* — the cost of the prefix sub-alignment does not depend on the last column's choice. This independence (no "memory" of which characters were used, unlike a visited-set in path problems) is exactly why edit distance is polynomial while many string-*selection* problems are not, and it is the same memorylessness that makes the grid a DAG (Section 4).

**Worked Example 3.2 (one cell).** Computing `D[2][2]` for `A = "ab"`, `B = "ac"` (so `A[1]='b'`, `B[1]='c'`, differing): `D[2][2] = min(D[1][1] + 1, D[1][2] + 1, D[2][1] + 1) = min(0+1, 1+1, 1+1) = 1`. The minimizing predecessor is the diagonal `D[1][1]` via a substitution `b→c`, matching the alignment `ab / ac`. This is the recurrence and traceback in microcosm.

---

## 4. Alignment as a Shortest Path in the Edit Grid

**Definition 4.1 (Edit grid).** The *edit graph* `G(A,B)` has vertex set `{(i,j) : 0 ≤ i ≤ n, 0 ≤ j ≤ m}` and directed edges:
- `(i-1, j-1) → (i, j)` of weight `σ(A[i-1], B[j-1])` (diagonal),
- `(i-1, j) → (i, j)` of weight `1` (vertical, deletion),
- `(i, j-1) → (i, j)` of weight `1` (horizontal, insertion).

Note the diagonal edge weight `σ(A[i-1], B[j-1])` is `0` for a match and `1` for a mismatch — so matches are "free shortcuts" and the shortest path naturally maximizes matched characters, the geometric reason matches dominate optimal alignments.

**Theorem 4.2.** `d(A, B)` equals the weight of a shortest path from `(0,0)` to `(n,m)` in `G(A,B)`, and the DP fill is exactly relaxation of this DAG in any topological order.

**Proof.** A path from `(0,0)` to `(n,m)` is a monotone lattice path; reading its edges left-to-right yields an alignment whose column costs are the edge weights (diagonal = match/sub, axis-moves = indels), and every alignment arises from exactly one such path (Proposition 1.4). Hence path weights and alignment costs are in cost-preserving bijection, and the minimum of one equals the minimum of the other. The recurrence `D[i][j] = min over in-edges of (D[pred] + weight)` is Bellman relaxation, correct because the grid is a DAG with `(i,j)` ordered by `i + j`. ∎

**Corollaries used downstream.**
- *(Monotonicity.)* Every optimal path is monotone, so it visits each anti-diagonal `i + j = const` exactly once; traceback is `O(n + m)`.
- *(Diagonal confinement.)* A path of weight `≤ k` uses at most `k` non-diagonal edges, and a non-diagonal edge changes `i − j` by `±1`. Diagonal edges keep `i − j` fixed. Starting at `i − j = 0`, after at most `k` axis-moves `|i − j| ≤ k` throughout. **This single fact is the correctness core of banding/Ukkonen (Section 7).**

**Worked Example 4.3 (grid as DAG).** For `A = "ab"`, `B = "cb"` the `3×3` node grid has the optimal path `(0,0) →[sub a→c, w=1] (1,1) →[match b, w=0] (2,2)`, total weight `1`, matching `d("ab","cb") = 1`. The alternative path `(0,0)→(0,1)→(1,1)→(2,2)` (insert `c`, delete `a`, match `b`) has weight `2` — a valid but non-optimal alignment. Reading edge labels along the optimal path *is* the alignment; the DP `min` at each node selects the cheapest incoming edge, which is precisely shortest-path relaxation in topological (anti-diagonal) order.

**Why a DAG and not a general shortest-path problem.** All edges increase `i + j` by exactly 1 (axis moves) or 2 (diagonal), so `i + j` is a strict topological potential: there are no cycles, and a single sweep in increasing `i + j` (or row-major) order suffices. This is why the `O(nm)` DP needs no priority queue (unlike Dijkstra on a general weighted graph) — the DAG structure makes simple in-order relaxation optimal, and it is also why edit distance, despite "being shortest path," avoids the `log` factor a heap would impose.

---

## 5. The Lipschitz Property of the DP Table

**Theorem 5.1.** Adjacent cells of the edit-distance table differ by at most 1, and along a diagonal by 0 or +1:
- `|D[i][j] − D[i-1][j]| ≤ 1`,
- `|D[i][j] − D[i][j-1]| ≤ 1`,
- `D[i][j] − D[i-1][j-1] ∈ {0, 1}`.

**Proof.** *Vertical.* From `(i-1, j)` one deletion reaches `(i, j)`, so `D[i][j] ≤ D[i-1][j] + 1`. For the other direction, an optimal alignment of `A[0..i)` vs `B[0..j)` can be turned into one of `A[0..i-1)` vs `B[0..j)` by removing `A[i-1]`'s column at extra cost ≤ 1, so `D[i-1][j] ≤ D[i][j] + 1`. Together `|D[i][j] − D[i-1][j]| ≤ 1`. The horizontal case is symmetric. *Diagonal.* `D[i][j] ≤ D[i-1][j-1] + σ ≤ D[i-1][j-1] + 1` by the recurrence; and `D[i][j] ≥ D[i-1][j-1]` because aligning one-longer prefixes cannot strictly *decrease* the optimal cost by more than the boundary allows — formally, prepend the optimal sub-alignment's structure; the gap of at least the diagonal predecessor holds since removing the last matched/aligned pair lowers cost by at most 1 and never raises the predecessor below `D[i-1][j-1]`. Hence the diagonal difference is `0` or `1`. ∎

**Significance.** This "the table is 1-Lipschitz" property is exactly what **Myers' bit-vector algorithm** (Section 8) encodes: instead of storing values, store the **horizontal and vertical adjacent differences**, each in `{−1, 0, +1}`, as bitmasks. Two bits per cell suffice, enabling `w` cells per machine word.

**Corollary 5.2 (anti-diagonal monotonicity).** Along the main diagonal, `D[i][i]` is non-decreasing in `i` only in the unweighted match-free worst case; in general `D[i][i] − D[i-1][i-1] ∈ {0, 1}` by the diagonal bound. More useful: the entire table is determined by its first row, first column, and the *difference* vectors — which is the algebraic statement underlying both Myers (store differences) and the four-Russians speedup (precompute how a length-`t` block of differences transforms, then apply it in `O(1)` per block via a lookup table, giving `O(nm / log n)` for bounded alphabets).

**Worked Example 5.3 (differences).** For `A = "ab"`, `B = "ac"` the table is
```
    ε  a  c
ε   0  1  2
a   1  0  1
b   2  1  1
```
Vertical differences down column `c` (j=2): `2→1→1`, i.e. `(−1, 0)` ∈ `{−1,0,+1}`. Horizontal differences across row `b` (i=2): `2→1→1`, i.e. `(−1, 0)`. Diagonal `D[2][2] − D[1][1] = 1 − 0 = 1 ∈ {0,1}`. Every adjacent pair obeys Theorem 5.1, confirming the table is 1-Lipschitz and storable as 2-bit differences.

---

### 5.4 The Four-Russians Speedup

The Lipschitz property enables a `O(nm / log n)` algorithm (Masek-Paterson 1980) for bounded alphabets, the only known *unconditional* asymptotic improvement over `O(nm)` for the unrestricted problem (and it is only a `log` factor).

**Idea.** Partition the table into `t × t` blocks. Because adjacent cells differ by `{−1, 0, +1}`, a block is fully determined by its top row's *difference vector* (`t` ternary values), its left column's difference vector, and the `2t` characters labeling its rows/columns. There are only `O(3^t · 3^t · |Σ|^{2t})` distinct block-input classes. Precompute, for each class, the block's bottom row and right column difference vectors and store them in a lookup table. Then the main DP processes the table block-by-block, each block resolved in `O(1)` table lookups instead of `O(t²)` cell computations.

**Theorem 5.5 (Masek-Paterson).** For a constant-size alphabet, choosing `t = Θ(log_{|Σ|} n)` yields edit distance in `O(nm / log n)` time after `O(n^{ε})`-size precomputation (for any `ε > 0`).

**Proof sketch.** With `t = (log_σ n)/2`, the number of block classes is `o(n)`, so the lookup table is sub-linear in size and built in sub-linear time. The DP has `(n/t)(m/t)` blocks, each `O(1)`, totaling `O(nm/t²)` — but each block lookup also reads/writes `O(t)` difference values along its boundary, giving `O(nm/t) = O(nm / log n)`. ∎

**Practical note.** Four-Russians is rarely implemented: the constant factors and the cache-unfriendly table lookups make it slower than cache-tuned plain DP or Myers' bit-parallelism for realistic `n`. Myers' `O(nm/w)` achieves a comparable (constant `w = 64`) speedup with far simpler, branch-light code. The four-Russians result is primarily of *theoretical* interest as the lone unconditional sub-`nm` algorithm, and as the conceptual ancestor of bit-parallel methods (both exploit the bounded-difference structure to batch many cells).

### 5.5 Traceback Cost and the Space-Time Frontier

| Goal | Time | Space | Mechanism |
|------|------|-------|-----------|
| Distance only | `O(nm)` | `O(min(n,m))` | two rows |
| Distance + alignment | `O(nm)` | `O(nm)` | full table + traceback |
| Distance + alignment, low space | `O(nm)` | `O(min(n,m))` | Hirschberg (Section 6) |
| Distance, small `d` | `O(nd)` | `O(d)` | Ukkonen (Section 7) |
| Distance, word-parallel | `O(nm/w)` | `O(m/w)` | Myers (Section 8) |
| Distance, bounded alphabet | `O(nm/log n)` | `O(nm/log n)` | four-Russians (5.4) |

The frontier is fundamental: you cannot get *both* `o(nm)` time (for arbitrary `d`) *and* exactness, by the SETH bound (Section 10). Every row above either restricts `d` (Ukkonen), wins a constant/`log` factor (Myers, four-Russians), or trades only space (Hirschberg) — none breaks the conditional quadratic-time wall for exact, arbitrary-distance computation.

---

## 6. Hirschberg's Linear-Space Algorithm: Correctness

Hirschberg recovers an optimal alignment in `O(min(n,m))` space (not just the distance) by divide and conquer on the **midpoint of the optimal path**.

**Setup.** Let `Df[i][j]` be the forward distance `d(A[0..i), B[0..j))` and `Dr[i][j]` the distance `d(A[i..n), B[j..m))` of the reversed suffixes. Both row functions are computable in `O(m)` space by the two-row DP.

**Theorem 6.1 (Midpoint).** Fix `i* = ⌊n/2⌋`. Then

```
d(A, B) = min_{0 ≤ j ≤ m} ( Df[i*][j] + Dr[i*][j] ),
```

and a `j*` attaining the minimum is a column through which some optimal path crosses row `i*`.

**Proof.** Any alignment of `A` and `B` partitions at row `i*` into an alignment of `A[0..i*)` with some prefix `B[0..j)` and an alignment of `A[i*..n)` with the complementary suffix `B[j..m)`, for the column `j` where the path crosses row `i*` (a monotone path crosses each row in a contiguous run; pick the crossing column). The cost is `(cost of top part) + (cost of bottom part) ≥ Df[i*][j] + Dr[i*][j]`. Minimizing over `j` lower-bounds `d(A,B)`. Conversely, for the optimal `j*`, concatenating an optimal top alignment (cost `Df[i*][j*]`) with an optimal bottom alignment (cost `Dr[i*][j*]`) yields a full alignment of cost `Df[i*][j*] + Dr[i*][j*]`, an upper bound. The two bounds meet. ∎

**Theorem 6.2 (Complexity).** Hirschberg runs in `O(nm)` time and `O(m)` space.

**Proof.** Space: each midpoint computation uses two-row forward and backward DPs, `O(m)` each, reused across recursion. Time: the top-level computes both half-tables, `O(nm)` cells. Recursion then solves two subproblems whose grid *areas* sum to half the original (the split at `(i*, j*)` discards the off-rectangle regions). The recurrence `T(area) = O(area) + T(area₁) + T(area₂)` with `area₁ + area₂ ≤ area/2`-style geometric shrinkage sums to `O(nm)` total. ∎

**The area-halving in detail.** At the top level we scan the full `n × m` grid (both halves), `Θ(nm)` work. The two recursive rectangles are `(i*) × (j*)` and `(n − i*) × (m − j*)`. With `i* = n/2`, their combined area is `(n/2)·j* + (n/2)·(m − j*) = (n/2)·m = nm/2`. So each recursion level does at most half the area of the previous, and `Σ_{ℓ≥0} nm/2^ℓ = 2nm = O(nm)`. The constant 2 (versus 1 for the plain full DP) is the price of linear space — Hirschberg is about 2× slower in time but quadratically smaller in memory.

**Base cases.** Recursion bottoms out when one string is empty (alignment is all indels of the other) or has length 1 (a single scan finds the best single-character placement). Mishandling these — e.g. recursing on a zero-height rectangle — is the dominant Hirschberg bug, which is why `tasks.md` Task 11 calls them out explicitly.

Hirschberg is the standard answer to "produce the alignment of two very long strings without `O(nm)` memory" (see `middle.md`).

**Worked Example 6.3 (midpoint selection).** Align `A = "AGTACGCA"` (`n=8`, so `i* = 4`) with `B = "TATGC"` (`m=5`). The forward DP gives the row `L[0..5] = d(A[0..4), B[0..j))` and the backward DP gives `R[0..5] = d(A[4..8), B[j..5))`. Suppose `L = [4,4,3,3,4,5]` and `R = [4,3,3,2,2,3]`; then `L[j] + R[j] = [8,7,6,5,6,8]`, minimized at `j* = 3` with total `5`. The optimal alignment therefore crosses row 4 at column 3, and Hirschberg recurses on `(A[0..4), B[0..3))` and `(A[4..8), B[3..5))`. Each subproblem is solved the same way; the union of recovered columns is a full optimal alignment, assembled with only `O(m)` memory live at any moment. (The exact `L, R` values depend on the strings; the point is the additive midpoint rule.)

**Subtlety: ties at the midpoint.** When several `j*` minimize `L[j] + R[j]`, any one yields *an* optimal alignment, but different choices give different (equally optimal) alignments. For reproducibility, fix a tie-break rule (e.g. smallest `j*`). This matches the traceback tie-break discussion in `junior.md` — optimal alignments are generally not unique.

### 6.4 A Fully Worked Hirschberg Divide Step (concrete arithmetic)

Example 6.3 left `L` and `R` symbolic. Here we carry out one complete divide step with real arithmetic on a pair small enough to verify by hand against the full table, so the midpoint identity (Theorem 6.1) is checkable digit-for-digit.

Take `A = "AGTA"` (`n = 4`, so `i* = ⌊4/2⌋ = 2`, splitting `A` into `A[0..2) = "AG"` and `A[2..4) = "TA"`) and `B = "TGA"` (`m = 3`). The true distance is `d("AGTA","TGA") = 2` (delete `A`, substitute `T→G`… we will confirm it).

**Forward row `L[j] = d("AG", B[0..j))`** — the two-row DP restricted to `A`'s top half `"AG"` against each prefix of `B = "TGA"`:

```
        ε   T   G   A
   ε    0   1   2   3
   A    1   1   2   2
   G    2   2   1   2
```

So the bottom row is `L = [2, 2, 1, 2]` for `j = 0,1,2,3` (i.e. `d("AG","") = 2`, `d("AG","T") = 2`, `d("AG","TG") = 1`, `d("AG","TGA") = 2`).

**Backward row `R[j] = d("TA", B[j..3))`** — align `A`'s bottom half `"TA"` against each *suffix* of `B`. We DP on the reversed strings `"AT"` vs reversed-suffix, equivalently fill the suffix distances directly:

```
   R[0] = d("TA","TGA") = 2     (delete G, delete A? no: T match, sub G→·, A match -> 1 sub +1 indel = 2)
   R[1] = d("TA","GA")  = 1     (sub T→G, A match)
   R[2] = d("TA","A")   = 1     (delete T, A match)
   R[3] = d("TA","")    = 2     (delete both)
```

So `R = [2, 1, 1, 2]` for `j = 0,1,2,3`.

**Midpoint combination.** Theorem 6.1 says `d(A,B) = min_j (L[j] + R[j])`:

```
   j:        0     1     2     3
   L[j]:     2     2     1     2
   R[j]:     2     1     1     2
   L+R:      4     3     2     4
```

The minimum is `2`, attained uniquely at `j* = 2`. This confirms `d("AGTA","TGA") = 2` **and** that an optimal path crosses row `i* = 2` at column `j* = 2`. Hirschberg therefore recurses on the two rectangles `(A[0..2), B[0..2)) = ("AG","TG")` and `(A[2..4), B[2..3)) = ("TA","A")`, splicing their recovered columns. Note the top subproblem has distance `L[2] = 1` (`"AG"` vs `"TG"`: substitute `A→T`) and the bottom has distance `R[2] = 1` (`"TA"` vs `"A"`: delete `T`), and `1 + 1 = 2` matches the whole — exactly the additive decomposition the theorem promises.

**Why this is the load-bearing step.** Everything else in Hirschberg is recursion and base cases; the *only* nontrivial computation per level is "compute `L` and `R` with two-row DPs, add them pointwise, take the argmin." Getting `R` right is the usual bug source: it is the distance of `A`'s *suffix* against `B`'s *suffix*, computed on **reversed** strings, and an off-by-one in the reversal silently shifts `j*` — producing a still-optimal-cost but **wrong** crossing column, which then mis-splits the recursion and corrupts the recovered alignment (while the distance, read from `min(L+R)`, stays correct, masking the bug). This is precisely why `tasks.md` Task 11's evaluation checks the *alignment*, not merely the distance.

---

## 7. Ukkonen's O(nd) Diagonal Algorithm: Correctness and Complexity

Let `d = d(A, B)` be the (unknown) answer. Ukkonen computes it in `O(n·d)` time when `d` is small, by exploiting diagonal confinement (Section 4 corollary) and a **farthest-reaching** front along diagonals.

The algorithm reorganizes the computation from "fill the table cell by cell" to "expand a frontier by edit count." Where the standard DP sweeps all `nm` cells regardless of the answer, Ukkonen processes cells in order of their *distance value*: first all cells reachable with 0 edits (the initial diagonal snake), then those needing 1 edit, and so on, halting the instant the corner is reached. When `d` is small this touches only an `O(nd)` sliver of the grid — the same output-sensitivity that makes BFS-by-level efficient on sparse shortest-path instances. It is, quite literally, a 0-1-BFS / Dijkstra-by-level on the edit DAG (Section 4), specialized so that the 0-weight diagonal edges are followed greedily (the snakes) and the weight-1 edges advance the edit budget.

**Definition 7.1 (Diagonal and reach).** Diagonal `h = j − i`. For an edit budget `e`, let `R(e, h)` be the *farthest-reaching* row `i` on diagonal `h` reachable with exactly `e` edits, after greedily extending through matching characters ("snake"). Formally, `R(e, h) = max { i : d(A[0..i), B[0..i+h)) ≤ e and the path uses exactly e non-diagonal moves up to here }`.

**Theorem 7.2 (Ukkonen recurrence).**
```
R(e, h) = snake( h, max( R(e-1, h-1) + 1,    # came via a deletion (i increases)
                         R(e-1, h)   + 1,    # came via a substitution
                         R(e-1, h+1) ) )      # came via an insertion (i unchanged)
```
where `snake(h, i)` slides `i` forward while `A[i] == B[i+h]` (free diagonal matches). The answer is the least `e` with `R(e, m−n)` reaching row `n` (i.e. the endpoint `(n, m)` on diagonal `m−n`).

**Proof of correctness.** By Section 4, an alignment of cost `e` is a monotone path with exactly `e` axis-moves. Inducting on `e`: a farthest-reaching point with `e` edits on diagonal `h` is obtained from a farthest point with `e−1` edits on an adjacent diagonal via one axis-move (insertion stays on the same `i`, deletion/substitution advances `i`), then a maximal run of free matches (the snake). Taking the max over the three predecessor diagonals gives the farthest reach; the snake is correct because matches are free and can never reduce reach. The endpoint condition holds because reaching `(n, m)` means the full strings are aligned at cost `e`, and we take the minimum such `e`, which is `d(A,B)`. ∎

**Theorem 7.3 (Complexity).** Ukkonen computes `d` in `O(n·d)` time and `O(d)` (or `O(n)`) space. For thresholded "is `d ≤ k`?" it is `O(k·n)`. With doubling (`k = 1,2,4,…`) when `d` is unknown, the cost is dominated by the last round, `O(n·d)`.

**Proof.** For each edit value `e = 0, 1, …, d`, only diagonals `h ∈ [−e, e]` can be reached (diagonal confinement), so the `e`-th wave updates `O(e)` diagonals, each in `O(1)` plus its snake. The snakes over all diagonals at a fixed `e` advance row indices that are monotone and bounded by `n`, so total snake work across all `e` is `O(n·d)`. Summing the `O(e)` per-wave cost over `e ≤ d` gives `O(d²)`, dominated by the `O(n·d)` snake term for `d ≤ n`. Doubling adds only a constant factor since work geometrically increases. ∎

This is the formal version of the banded/`O(nd)` algorithm in `middle.md`; the same farthest-reaching machinery is the basis of Myers' `O(nd)` diff.

**Worked Example 7.4 (wave expansion).** Align `A = "abcabba"`, `B = "cbabac"`. Wave `e = 0` snakes from `(0,0)` along the main diagonal `h = 0` only as far as the leading characters match (`a` vs `c` differ immediately, so `R(0,0) = 0`). Wave `e = 1` opens diagonals `h ∈ {−1, 0, 1}`: from each, one axis-move then a snake. As `e` grows, the live diagonal interval widens by one on each side, and each wave's snakes push the reach forward through matching runs. The algorithm stops at the smallest `e` whose wave reaches `(n, m)` on diagonal `h = m − n = −1`. Because only `2e+1` diagonals are live at wave `e`, total work to reach answer `d` is `O(nd)`, vastly less than the `64`-cell full table here when `d` is small.

**Relation between thresholded and doubling forms.** The thresholded `O(kn)` form fixes `k` and either returns the distance (if `≤ k`) or "exceeds `k`". The doubling form wraps it: run with `k = 1, 2, 4, …`; each run is `O(k·n)`, and the runs form a geometric series dominated by the final `k ∈ [d, 2d)`, so the total is `Σ_{k=1,2,4,…,≤2d} O(kn) = O(d·n)`. Crucially, doubling never needs to know `d` in advance and never over-pays by more than a factor of 2 — the standard exponential-search-to-output-sensitive-bound technique.

**Space optimization.** The farthest-reaching values `R(e, ·)` for the current `e` depend only on `R(e-1, ·)`, so two arrays of length `2·d+1` (indexed by diagonal) suffice — `O(d)` space — if you only need the *distance*. To recover the *alignment*, store the predecessor diagonal per `(e, h)` (or apply Hirschberg-style divide-and-conquer in the diagonal domain), trading some bookkeeping for the path. This mirrors the two-row vs full-table distinction (Section 11b): the cheap form gives the number; the alignment costs more memory or a second pass.

**Connection to Myers' diff.** Myers' `O(nd)` *diff* algorithm (the one behind `git diff`) is Ukkonen's farthest-reaching-diagonal recurrence specialized to the **LCS / indel-only** cost model (no substitution), where diagonals correspond to "snakes" of matching lines. The two algorithms are the same idea — explore the edit graph in order of increasing edit count, tracking the frontier per diagonal — applied to the substitution-allowing (Levenshtein) and substitution-free (LCS/diff) cost models respectively. Both are output-sensitive: fast exactly when the two inputs are similar, which is the common case for source-code diffs.

---

## 8. Myers' Bit-Vector Algorithm: Correctness Sketch

Myers (1999) computes a full DP column in `O(⌈m/w⌉)` word operations by storing the **vertical adjacent differences** of the table as bit vectors, justified by the Lipschitz property (Section 5).

**Encoding.** For a fixed text column (after processing text character `t`), define for each pattern row `i`:
- `Pv[i] = 1` iff `D[i][col] − D[i-1][col] = +1`,
- `Mv[i] = 1` iff `D[i][col] − D[i-1][col] = −1`,
- (the difference is `0` iff both bits are `0`).

The invariant maintained is that the *value* of cell `(i, col)` equals the column-top value plus the running sum of the vertical differences down to row `i`. Because the top value of each column is known (`D[0][col] = col` for global, `0` for approximate matching), and the differences are stored as bit vectors, the algorithm never materializes integer cell values except the single tracked bottom-row score — the engine works *entirely in the difference domain*. This is the structural inversion that the Lipschitz theorem (Section 5) makes possible: the absolute values are recoverable but never needed.

By Theorem 5.1 every vertical difference is in `{−1, 0, +1}`, so these two bitmasks losslessly represent the column up to the known top value. Horizontal differences `Ph, Mh` are defined analogously.

**The recurrence.** Let `Eq` be the bitmask of pattern positions equal to the current text character (precomputed per alphabet symbol). The new horizontal positive-difference vector is

```
Xv = Eq | Mv
Xh = (((Eq & Pv) + Pv) ^ Pv) | Eq
Ph = Mv | ~(Xh | Pv)
Mh = Pv & Xh
```

**Why the addition computes the min.** The recurrence `D[i][j] = min(diagonal, up+1, left+1)` becomes, in *difference* coordinates, a Boolean propagation of "a `−1` vertical difference (a decrease) created by a match must ripple upward through positions that would otherwise increase." The expression `(((Eq & Pv) + Pv) ^ Pv)` uses a single **arithmetic addition** to propagate that ripple as a carry chain across the word — this is the crux: the `min`/carry that the DP would compute cell-by-cell is done for `w` cells at once by the hardware adder. `Xh` then marks positions where the horizontal difference is `≤ 0`, from which `Ph` (horizontal +1) and `Mh` (horizontal −1) follow by Boolean identities derived from the cell recurrence and the Lipschitz constraints.

**Score update and shift.** The bottom-row value (the answer column entry) is maintained incrementally: it changes by `+1` if `Ph`'s high bit is set, `−1` if `Mh`'s high bit is set. The vectors are then shifted by one (moving to the next pattern row alignment) with the correct boundary carry-in, and `Pv, Mv` are recomputed from `Xv, Ph, Mh`. After processing all `n` text characters, the maintained score is `d(A, B)`.

**Correctness (sketch).** Each Boolean identity is verified by case analysis on the `{−1,0,+1}` differences of the three neighbor cells, using the recurrence and Theorem 5.1 to rule out impossible difference combinations; the carry-propagating add is shown to realize exactly the upward ripple of match-induced decreases. A full proof is a finite (if tedious) verification; in practice the algorithm is validated by **differential testing against the plain DP** (`senior.md` Section 10). For `m ≤ w` the per-character work is `O(1)` words, giving `O(n)`; for `m > w`, multi-word vectors with manual carry give `O(n·⌈m/w⌉)`. ∎ (sketch)

**Significance.** This is the fastest practical edit-distance kernel and the canonical demonstration that the Lipschitz structure (Section 5) is algorithmically load-bearing, not just descriptive.

### 8.1 Why two bits per cell suffice

By Theorem 5.1 the vertical difference `D[i][col] − D[i-1][col] ∈ {−1, 0, +1}`, a three-valued quantity needing `⌈log₂ 3⌉ = 2` bits. Myers uses exactly two bitmasks (`Pv` for `+1`, `Mv` for `−1`; both `0` encodes the `0` difference; the impossible `Pv = Mv = 1` never occurs). Thus a column of `m` cells is stored in `2⌈m/w⌉` machine words rather than `m` integers, and the per-character transition touches each word `O(1)` times. The information-theoretic floor is `2` bits/cell because consecutive cells genuinely realize all three differences on adversarial inputs, so Myers' encoding is optimal in bits up to the constant.

### 8.2 The carry chain as parallel min

The expression `(((Eq & Pv) + Pv) ^ Pv)` is worth dwelling on. In binary, adding `Pv` to `(Eq & Pv)` produces a carry that propagates from each set bit of `Eq & Pv` up through the contiguous run of set bits in `Pv` above it, flipping them; XOR-ing back `Pv` isolates exactly the positions the carry reached. Those positions are precisely where a match at a lower row forces a *decrease* to ripple upward — the cell-by-cell `min(diagonal-via-match, …)` that the scalar DP computes one cell at a time. The hardware adder thus evaluates `w` coupled `min` operations in a single instruction. This is the crux of the `O(w)`-factor speedup and the reason the algorithm cannot be expressed with pure bitwise ops (no shift/AND/OR/XOR sequence propagates an unbounded carry; the `+` is essential).

### 8.3 Worked Myers trace (tiny)

For pattern `B = "ab"` (`m=2`, `MASK = 0b11`, `last = 0b10`) and text `A = "ab"`:
- Init `Pv = 0b11` (all vertical diffs `+1`), `Mv = 0`, `score = 2`.
- Text char `'a'`: `Eq = 0b01` (position of `a` in `B`). Compute `Xv = Eq | Mv = 0b01`; `Xh = (((Eq&Pv)+Pv)^Pv)|Eq = (((0b01)+0b11)^0b11)|0b01 = ((0b100)^0b11)|0b01 = 0b111 & MASK |...`. The high bit of the resulting `Mh` sets, `score` decrements to `1`.
- Text char `'b'`: `Eq = 0b10`. The recurrence again propagates a decrease through the high bit; `score` decrements to `0`.
- Final `score = 0 = d("ab","ab")`. ✓

(The intermediate masks are fiddly to hand-trace — the canonical validation is differential testing against the scalar DP over thousands of random pairs, as stated in `senior.md` Section 10. The point of the trace is to see the running `score` track the true distance via high-bit updates.)

---

## 8b. Correctness of Local Alignment and Affine Gaps

The alignment variants of `middle.md` (Smith-Waterman, Gotoh) deserve correctness statements, as they are the scoring duals of edit distance.

**Theorem 8b.1 (Smith-Waterman / local alignment).** With scores `s(x,y)` (substitution/match) and `g < 0` (gap), define `H[i][j] = max(0, H[i-1][j-1] + s(A[i-1],B[j-1]), H[i-1][j] + g, H[i][j-1] + g)`. Then `max_{i,j} H[i][j]` is the maximum score over all *local* alignments — alignments of a contiguous substring of `A` with a contiguous substring of `B`.

**Proof.** `H[i][j]` is the best score of an alignment *ending at* `(i,j)` that may start anywhere — the `max(0, …)` term lets the alignment "restart" (begin a fresh local segment) whenever continuing would make the score negative. By induction, `H[i][j]` equals the best-scoring alignment of some suffix of `A[0..i)` against some suffix of `B[0..j)` (or the empty alignment, score 0). Taking the global max over all `(i,j)` selects the best end cell, hence the best local segment. Traceback from the argmax to the first `0` recovers the segment endpoints. ∎ The clamp-to-zero is exactly what distinguishes local from global (Needleman-Wunsch, which has no clamp and reads the answer at the corner).

**Theorem 8b.2 (Gotoh affine-gap correctness, `O(nm)`).** With gap cost `open + L·extend` for a run of `L` indels, the three-layer recurrence
```
M[i][j] = s(A[i-1],B[j-1]) + max(M[i-1][j-1], X[i-1][j-1], Y[i-1][j-1])
X[i][j] = max(M[i-1][j] − (open+extend), X[i-1][j] − extend)
Y[i][j] = max(M[i][j-1] − (open+extend), Y[i][j-1] − extend)
```
computes the optimal affine-gap alignment, with answer `max(M,X,Y)[n][m]`.

**Proof.** The three states encode the *type of the last column*: `M` = last column is a (mis)match, `X` = last column is a gap in `B` (deletion run), `Y` = last column is a gap in `A` (insertion run). Extending an existing gap (`X[i-1][j] − extend`) charges only `extend`; *opening* a gap from a match state (`M[i-1][j] − (open+extend)`) charges `open+extend`. The optimal alignment's last column is exactly one of these three types, and its prefix is optimal within its ending-state by optimal substructure. Tracking which state is the source during traceback recovers the alignment. The `O(nm)` bound holds because the naive `O(nm(n+m))` affine recurrence (which would scan all gap lengths) is replaced by the constant-state recurrence: "in a gap of unknown length" is captured by the single bit of which layer you are in. ∎

**Why three layers and not one.** A single-layer DP cannot tell whether arriving at `(i,j)` continues an existing gap (cost `extend`) or starts one (cost `open+extend`), because that depends on *how* the predecessor was reached — information a flat table discards. The `X`/`Y` layers carry exactly that one bit of history, restoring the Markov property the affine cost otherwise breaks. This is the same "add a state to restore memorylessness" pattern seen across DP-on-strings.

---

## 9. Damerau-Levenshtein and Weighted Variants

**Damerau-Levenshtein** adds adjacent transposition at cost 1. The restricted (Optimal String Alignment) recurrence adds the case

```
D[i][j] = min( …, D[i-2][j-2] + 1 )   if i,j ≥ 2 and A[i-1]=B[j-2] and A[i-2]=B[j-1].
```

The guard `A[i-1]=B[j-2] and A[i-2]=B[j-1]` detects that the last two characters of the two prefixes are swapped; the move `D[i-2][j-2] + 1` charges a single transposition for both. Without this case, the swap would be handled by the three standard moves at cost 2 (delete + insert, or two substitutions). The OSA restriction is encoded *implicitly*: because the recurrence only looks back two cells and never revisits, it cannot also edit *inside* the swapped pair, which is precisely the behavior that breaks metricity (Proposition 9.1).

**Proposition 9.1.** OSA distance is **not** a metric in general: it can violate the triangle inequality because it forbids editing a transposed substring again, so a "shortcut" available to `d(x,z)` may be blocked. The *true* Damerau-Levenshtein distance (allowing arbitrary further edits of transposed regions, computed with an extra last-occurrence table) **is** a metric. This distinction matters for BK-tree correctness (Section 2 / `senior.md`): index with true DL or unit Levenshtein, not OSA, if you rely on the triangle inequality.

**Worked counterexample to OSA metricity.** Consider `x = "CA"`, `y = "ABC"`, `z = "BC"`. (Concrete values depend on the variant, but the standard witness uses the fact that OSA cannot re-edit a transposed pair.) The classic textbook witness is `OSA("CA", "ABC") = 3`, `OSA("CA", "AC") = 1`, `OSA("AC", "ABC") = 1`, so `OSA("CA","ABC") = 3 > OSA("CA","AC") + OSA("AC","ABC") = 1 + 1 = 2`, violating the triangle inequality. The transposition `CA → AC` is cheap, and from `AC` an insertion reaches `ABC`, but OSA's restriction prevents it from *combining* these on the direct `CA → ABC` computation, so the direct distance overshoots the composed path. True Damerau-Levenshtein recomputes `DL("CA","ABC") = 2`, restoring the inequality. **This is the precise formal reason `senior.md` warns against indexing a BK-tree with OSA distance.**

**Theorem 9.4 (true DL is a metric).** With the alphabet-indexed last-occurrence table, true Damerau-Levenshtein satisfies all four metric axioms. The proof mirrors Theorem 2.1: transposition is its own inverse (swapping back costs 1), giving symmetry; and because the unrestricted variant allows any operation anywhere, the composed-edit-sequence argument for the triangle inequality goes through unchanged (the OSA restriction was the only obstacle, and true DL drops it).

**Weighted edit distance.** Allow `cost_ins, cost_del, cost_sub(x,y) ≥ 0`. The recurrence carries arbitrary costs. **Proposition 9.2.** The weighted distance is a metric iff the cost function induces a metric on `Σ ∪ {ε}` (symmetric, triangle-satisfying substitution costs, and `cost_ins = cost_del`). Asymmetric costs (insert ≠ delete) break symmetry and hence metricity; Needleman-Wunsch *scores* (which maximize similarity, possibly with negative mismatch rewards) are not distances at all, though they are dual to a distance when `match = 0` and penalties are unit (see `middle.md`).

**Proof sketch of 9.2.** Treat each operation as an edge in `Σ ∪ {ε}` with `ε` the gap symbol: a substitution `x→y` is an edge of weight `cost_sub(x,y)`, an insertion is `ε→y` of weight `cost_ins(y)`, a deletion is `x→ε` of weight `cost_del(x)`. The weighted edit distance between strings is the cheapest alignment, i.e. the cheapest way to pair characters via these single-symbol edge costs. *Symmetry* of the string distance requires each single-symbol edge to be reversible at equal cost — substitution costs symmetric (`cost_sub(x,y) = cost_sub(y,x)`) and `cost_ins(c) = cost_del(c)` (the gap edge reversible). *Triangle inequality* of the string distance reduces, by the column-decomposition argument of Theorem 2.1, to the triangle inequality of the *per-symbol* cost on `Σ ∪ {ε}`: if `cost_sub(x,z) ≤ cost_sub(x,y) + cost_sub(y,z)` for all symbols (and analogously through `ε`), the composite-alignment argument of Theorem 2.1(3) lifts it to strings. If the per-symbol cost violates the triangle inequality (e.g. `cost_sub(a,c) = 5` but `cost_sub(a,b) + cost_sub(b,c) = 3`), then `d("a","c")` would be `5` while the path through `"b"` costs `3`, breaking the string triangle inequality. Hence the per-symbol metric conditions are both necessary and sufficient. ∎

**Worked Example 9.3 (non-metric weighting).** Let `cost_ins = 1`, `cost_del = 3` (asymmetric). Then `d("a", "") = 3` (delete) but `d("", "a") = 1` (insert), so `d` is not symmetric and not a metric. A BK-tree built on this cost would prune incorrectly. This is the formal reason `senior.md` insists on unit (or symmetric) costs for metric-space indexing.

---

## 10. The SETH-Based Quadratic Lower Bound

The `O(nm)` upper bound has resisted improvement, and fine-grained complexity explains why.

**Theorem 10.1 (Backurs-Indyk 2015).** If edit distance on two strings of length `n` can be computed in `O(n^{2-δ})` time for some constant `δ > 0`, then the **Strong Exponential Time Hypothesis (SETH)** is false.

**SETH.** SETH posits that for every `ε > 0` there is a `k` such that `k`-SAT on `N` variables cannot be solved in `O(2^{(1-ε)N})` time — i.e. SAT has no "savable" exponential speedup. It is a standard hardness assumption in fine-grained complexity, strictly stronger than P ≠ NP, and is the source of most known *polynomial* conditional lower bounds (the "fine-grained" hardness program: a problem solvable in `O(n^c)` may still be provably not solvable in `O(n^{c−ε})` under SETH, even though it is firmly in P).

**Proof idea.** Backurs and Indyk give a *reduction* from the Orthogonal Vectors problem (which is SETH-hard) to edit distance: given two sets of Boolean vectors, they construct two strings (via carefully designed *vector gadgets* and *coordinate gadgets*) whose edit distance encodes whether an orthogonal pair exists. A truly subquadratic edit-distance algorithm would solve Orthogonal Vectors subquadratically, which refutes SETH. The gadgets ensure that small edit-distance differences correspond exactly to the existence of an orthogonal pair, so an exact (or even sufficiently accurate) subquadratic algorithm transfers. ∎ (reduction sketch)

**The Orthogonal Vectors (OV) problem.** Given two sets `U, V ⊆ {0,1}^D` each of size `N`, with `D = ω(log N)`, decide whether there exist `u ∈ U, v ∈ V` with `⟨u, v⟩ = 0` (orthogonal, i.e. no coordinate where both are 1). The brute force is `O(N² D)`. **The OV hypothesis** (implied by SETH) states OV needs `N^{2−o(1)}` time. The Backurs-Indyk reduction encodes each vector as a string gadget such that two strings are "close" in edit distance iff the corresponding vectors are orthogonal, and the global edit distance of two concatenated-gadget strings reveals whether *any* orthogonal pair exists. A subquadratic edit-distance algorithm would yield a subquadratic OV algorithm, refuting OV and hence SETH.

**Gadget intuition (high level).** The reduction builds, for each vector, a *coordinate gadget* whose alignment cost is small exactly when the two vectors share no common 1-coordinate, and a *vector gadget* that aligns one query vector against all candidate vectors. Careful padding ensures the only way to achieve below-threshold edit distance is to find an orthogonal pair; the thresholds are spaced so that a single orthogonal pair shifts the global distance by a detectable amount. The technical work is making these gadgets *robust* — the cost difference between "orthogonal pair exists" and "none exists" must survive the global `min` over all alignments — which is why the construction is intricate even though the idea is a direct encoding.

**Consequences.**
- **Exact** edit distance is "conditionally quadratic": no `O(n^{2-δ})` algorithm exists unless SETH fails. This is why all the speedups in this topic are *conditional* on structure — small distance (Ukkonen `O(nd)`), word-parallelism (Myers `O(nm/w)`, a constant-factor not asymptotic win), or approximation.
- **Approximation** escapes the barrier: there are subquadratic `O(1)`-approximation and `(1+ε)`-approximation algorithms (e.g. Chakraborty-Das-Goldenberg-Koucký-Saks 2018 gave a constant-factor approximation in subquadratic time), because the lower bound is for *exact* computation.
- **Practical reading:** band when `d` is small, bit-parallelize the constant, or approximate; do not expect a general subquadratic *exact* algorithm.
- **LCS inherits the bound.** Because LCS and edit distance are interreducible (Section 11), the same SETH-conditional `n^{2−o(1)}` lower bound holds for LCS (Abboud-Backurs-Williams 2015), and even for computing LCS of two binary strings.
- **Why Myers does not contradict the bound.** Myers' `O(nm/w)` is *not* subquadratic: `w` is a constant (64), so `O(nm/w) = O(nm)` asymptotically — a constant-factor win, fully consistent with the lower bound. Likewise Ukkonen's `O(nd)` is subquadratic only when `d = o(n)`; for `d = Θ(n)` it is `Θ(n²)`. The lower bound forbids a *general* `O(n^{2−δ})` for *arbitrary* inputs, which none of these achieve.

### 10.1 Approximate Matching: Base-Case Correctness

The `k`-approximate substring-matching variant (`middle.md`) changes only the top row to `D[0][j] = 0`. We justify this formally.

**Theorem 10.2.** Let `P` (length `m`) be the pattern, `T` (length `n`) the text. Define `E[i][j]` by `E[0][j] = 0` for all `j`, `E[i][0] = i`, and the standard three-way recurrence. Then `E[m][j] = min_{0 ≤ s ≤ j} d(P, T[s..j))`, the minimum edit distance from `P` to any substring of `T` ending at position `j`.

**Proof.** `E[i][j]` with the zeroed top row equals `min_s d(P[0..i), T[s..j))`: the top-row zeros let an alignment "start" the pattern at any text column `s` at no cost (the path may enter the interior from any `(0, s)` for free), and the rest of the recurrence is the ordinary prefix-alignment DP. Setting `i = m` consumes all of `P`, so `E[m][j]` is the cheapest alignment of the whole pattern against some text substring ending at `j`. ∎

**Corollary 10.3.** The positions `j` with `E[m][j] ≤ k` are exactly the end positions of `k`-approximate occurrences of `P` in `T`. Banding restricts each column's relevant rows to those with `E[i][j] ≤ k`, which lie within `i ∈ [j − (something)]`-style windows, giving `O(kn)` (the formal band here is over the *score*, computed à la Ukkonen down the text). Traceback from a qualifying `(m, j)` to the top row recovers the matched substring's start `s`.

**Worked Example 10.4.** Pattern `P = "ana"`, text `T = "banana"`, `k = 1`. Filling the column DP with `E[0][j] = 0`:
```
      b  a  n  a  n  a
ε  0  0  0  0  0  0  0
a  1  1  0  1  0  1  0
n  2  2  1  0  1  0  1
a  3  3  2  1  0  1  0
```
The bottom row `E[3][·] = [3,2,1,0,1,0]` is `≤ 1` at columns `j = 3` (value 1, match `"an"`+1 edit), `j = 4` (value 0, exact `"ana"` ending at position 4), and `j = 6` (value 0, exact `"ana"` ending at position 6). So `P` occurs within 1 edit ending at text positions 3, 4, and 6 — matching the two exact occurrences of `ana` in `banana` (overlapping) plus a 1-edit prefix match. This is the formal correctness of the "top row = 0" trick demonstrated numerically.

### 10.2 The Boolean / threshold view

For the decision problem "is `d(A,B) ≤ k`?", one can run the DP over the Boolean-capped semiring (values clamped at `k+1` = "too far"), which is what banding does implicitly. This is `O(kn)` and answers yes/no without producing the exact distance when it exceeds `k` — exactly the contract of `bounded_edit_distance` in `middle.md`. The decision version is no easier asymptotically than the exact version under SETH for `k = Θ(n)`, but for *small* `k` it is genuinely cheaper (`O(kn) ≪ O(n²)`), which is why approximate-matching systems fix a small `k`.

---

## 11. Relationship to Longest Common Subsequence

Edit distance and **Longest Common Subsequence (LCS)** are close cousins, and contrasting them is illuminating (and a common interview theme — see `interview.md`).

**Definition 11.1.** `LCS(A, B)` is the length of the longest sequence that is a subsequence of both `A` and `B`. (A *subsequence* drops zero or more characters without reordering — distinct from a *substring*, which must be contiguous.)

**Theorem 11.2 (Indel distance = `n + m − 2·LCS`).** If only insertions and deletions are allowed (no substitutions) — the *indel distance* `d_id` — then

```
d_id(A, B) = n + m − 2·LCS(A, B).
```

**Proof.** An alignment using only matches and indels pairs up exactly the characters of a common subsequence as matches; the matched characters number `LCS` at best, leaving `n − LCS` characters of `A` to delete and `m − LCS` of `B` to insert. Minimizing indels maximizes matches, i.e. uses the longest common subsequence, giving `n + m − 2·LCS`. ∎

**Contrast with Levenshtein.** Levenshtein *additionally* allows substitution at cost 1, so `d(A,B) ≤ d_id(A,B)` (a substitution can replace a delete+insert pair, saving 1). Thus LCS-based distance and Levenshtein distance differ precisely by how substitutions are priced. Both share the `O(nm)` DP, the grid-shortest-path structure, the SETH quadratic barrier (LCS has the same conditional lower bound), and the Hirschberg/banded/bit-parallel speedups. The difference is one term in the recurrence: LCS rewards matches and forbids the cost-1 diagonal substitution, whereas Levenshtein permits it.

**Worked Example 11.3.** For `A = "AGCAT"` (`n=5`), `B = "GAC"` (`m=3`): `LCS = 2` (e.g. `"GC"` or `"AC"` or `"GA"` — all length 2). Then `d_id = n + m − 2·LCS = 5 + 3 − 4 = 4` (delete `A`, then align; concretely delete 3 chars of `A` and insert 1 of `B` not matched, balancing to 4 indels around the 2 matches). Levenshtein `d(A,B) = 3` (e.g. substitute and delete), which is strictly less than `d_id = 4` because a substitution beats a delete+insert pair. The example numerically separates the two distances and confirms the formula.

**Bounds relating the two.** For all `A, B`: `d_id(A,B)/2 ≤ d(A,B) ≤ d_id(A,B)`. The upper bound is shown above (substitutions only help). The lower bound holds because each Levenshtein substitution can be simulated by at most one delete + one insert, so an edit script of cost `d` yields an indel script of cost at most `2d`, giving `d_id ≤ 2d`. These bounds let you estimate one distance from the other within a factor of 2 without recomputation — occasionally useful as a cheap filter.

**Why both have the same DP shape.** Both are instances of the *sequence-alignment* DP over the edit grid (Section 4): they differ only in the edge weights of the diagonal (LCS: `−1` reward on match, `+∞`/forbidden on mismatch when maximizing matches; Levenshtein: `0` on match, `1` on mismatch). The shared structure is why every algorithmic technique in this topic — Hirschberg's linear space, Ukkonen's `O(nd)`, Myers' bit-parallelism, the SETH lower bound — transfers between them essentially unchanged.

---

## 11b. Correctness of the Two-Row and Banded Reductions

Two everyday optimizations deserve formal justification, since they are the ones most often mis-implemented.

**Theorem 11b.1 (two-row correctness).** Filling the table row by row, keeping only the previous row `prev` and the current row `cur`, computes `D[n][m]` correctly.

**Proof.** The recurrence `D[i][j] = f(D[i-1][j-1], D[i-1][j], D[i][j-1])` references only the previous row (`i-1`) and the current row's already-computed left neighbor (`j-1`). Processing `j` in increasing order means `cur[j-1]` is set before `cur[j]`, and `prev` still holds row `i-1`. Hence every referenced value is available, and the computed `cur` equals row `i` of the full table. After the last row, `cur[m] = D[n][m]`. ∎ **Caveat:** this discards the table, so **traceback is impossible** from two rows alone — recovering the alignment requires the full table or Hirschberg. This is the formal version of the `junior.md` warning.

**Theorem 11b.2 (banded correctness).** If `d(A,B) ≤ k`, then filling only cells with `|i − j| ≤ k` (treating out-of-band cells as `+∞`) computes `D[n][m]` exactly.

**Proof.** By diagonal confinement (Section 4 corollary), any optimal path of cost `≤ k` stays within `|i − j| ≤ k`, so it never uses an out-of-band cell; setting those to `+∞` cannot exclude the optimal path. Conversely, no in-band cell's value depends on an out-of-band predecessor *along an optimal path* (an out-of-band predecessor would already exceed `k`). Hence the banded fill of `D[n][m]` equals the full-table value whenever that value is `≤ k`. If `d(A,B) > k`, the banded fill returns a value `> k` (or `+∞`), correctly signaling "exceeds `k`" — though it does **not** return the true distance in that case. ∎

**Theorem 11b.3 (length-gap prefilter).** If `| |A| − |B| | > k` then `d(A,B) > k`.

**Proof.** Any alignment must account for the length difference using indels: at least `| n − m |` indels are required (each indel changes the length difference by 1, and substitutions/matches do not). Each indel costs 1, so `d(A,B) ≥ |n − m| > k`. ∎ This `O(1)` check (used throughout `senior.md` and `middle.md`) rejects most non-matches before any DP work.

**Theorem 11b.4 (common-prefix/suffix trimming).** If `A = p·A'·s` and `B = p·B'·s` share prefix `p` and suffix `s`, then `d(A, B) = d(A', B')`.

**Proof.** An optimal alignment can always be chosen to match the shared prefix and suffix character-for-character at cost 0: any alignment that does not can be rearranged to do so without increasing cost (matching identical characters is never worse than substituting/indel-ing them, since a match costs 0). Removing the matched prefix/suffix columns leaves an optimal alignment of `A'` with `B'`. ∎ This justifies the senior-level trimming optimization, which shrinks the effective problem size before banding — particularly powerful for near-duplicate strings (long shared prefix/suffix, tiny differing middle).

**Combined fast path.** A production "distance ≤ k?" routine composes all four: (1) length-gap reject (Thm 11b.3), (2) trim common prefix/suffix (Thm 11b.4), (3) banded fill (Thm 11b.2) with (4) two-row memory (Thm 11b.1) and an Ukkonen early bailout. Each step is individually proven correct here, so the composite is correct — and it is the exact pipeline `senior.md` §7 describes for per-candidate verification.

---

## 12. Summary

- **Metric.** Levenshtein distance is a genuine metric (non-negativity, identity, symmetry, triangle inequality), proved by composing/reversing edit sequences. Metricity is the precondition for BK-tree indexing.
- **Recurrence.** Correct by optimal substructure on the last alignment column (full proof deferred to the DP sibling topic); the value at `(n,m)` is the distance.
- **Grid shortest path.** Edit distance is a shortest path in the edit DAG; alignments ≡ monotone lattice paths. Monotonicity bounds traceback to `O(n+m)`; diagonal confinement (`|i−j| ≤ k` for cost-`k` paths) underlies banding.
- **Lipschitz table.** Adjacent cells differ by at most 1; diagonal differences are 0 or 1 — the structural fact that Myers' bit-vector encoding exploits.
- **Hirschberg.** Optimal alignment in `O(min(n,m))` space via the midpoint identity `d = min_j (Df[i*][j] + Dr[i*][j])`, with `O(nm)` time by geometric area shrinkage.
- **Ukkonen `O(nd)`.** Farthest-reaching diagonals with snakes; correct by induction on the edit budget, fast because only `O(d)` diagonals are live at budget `d`. Doubling handles unknown `d`.
- **Myers `O(nm/w)`.** Encodes vertical/horizontal ±1/0 differences as bitmasks; a single carry-propagating addition realizes the cell `min` for `w` positions at once. Correct by case analysis; validated by differential testing.
- **Damerau/weighted variants.** OSA Damerau is *not* a metric; true Damerau is. Weighted distances are metrics only under symmetric, triangle-satisfying, `ins = del` costs.
- **SETH lower bound.** No `O(n^{2−δ})` exact algorithm unless SETH fails (Backurs-Indyk via Orthogonal Vectors); approximation escapes the barrier.
- **LCS contrast.** Indel-only distance equals `n + m − 2·LCS`; Levenshtein differs by pricing substitutions at 1. Same DP shape, same quadratic barrier.

### Complexity Cheat Table

| Task | Method | Complexity | Notes |
|------|--------|-----------|-------|
| Exact distance + alignment | DP + traceback | `O(nm)` time, `O(nm)` space | conditionally optimal (SETH) |
| Alignment, linear space | Hirschberg | `O(nm)` time, `O(min(n,m))` space | midpoint divide-and-conquer |
| Distance when `d` small | Ukkonen / banded | `O(nd)` (or `O(kn)` thresholded) | diagonal confinement |
| Distance, word-parallel | Myers | `O(n·⌈m/w⌉)` | bit-vector, ±1/0 differences |
| Indel-only distance | via LCS | `O(nm)` | `n + m − 2·LCS` |
| Exact, subquadratic | — | impossible under SETH | use approximation instead |
| Four-Russians (bounded Σ) | block lookup | `O(nm / log n)` | only unconditional sub-`nm` |
| Approximate `(1+ε)` distance | sampling/embedding | subquadratic | escapes SETH barrier |

### The Theory-to-Practice Map

Each theoretical result in this file licenses a concrete technique elsewhere in the topic:

- **Metricity (§2)** → BK-tree pruning (`senior.md` §3). Without the triangle inequality, the index is incorrect.
- **Grid-shortest-path (§4)** → the entire alignment/traceback machinery and the diagonal-confinement that justifies banding.
- **Lipschitz table (§5)** → Myers' 2-bit encoding (`senior.md` §6) and four-Russians.
- **Hirschberg correctness (§6)** → linear-space alignment of long sequences (`middle.md`).
- **Ukkonen correctness (§7)** → `O(nd)` near-match verification and `k`-approximate search (`middle.md`, `senior.md` §7).
- **Approximate-matching base case (§10.1)** → the "top row = 0" trick for finding patterns in text within `k` edits.
- **Two-row/banded/length-gap reductions (§11b)** → the everyday optimizations in all files, with the precise conditions under which they are valid (and when they only report "> k" rather than the true distance).
- **SETH bound (§10)** → the explanation for *why* every speedup is conditional on structure; nobody is hiding a general subquadratic exact algorithm.

The unifying message: edit distance is a metric, computed as a shortest path on a 1-Lipschitz DAG, conditionally quadratic to compute exactly, and accelerable only by exploiting small distance, machine words, bounded alphabets, or approximation — and every production technique in `senior.md` is one of these structural exploits with a proof in this file behind it.

References: Levenshtein (1965); Wagner-Fischer (1974) for the DP; Hirschberg (1975) for linear space; Masek-Paterson (1980) for four-Russians; Ukkonen (1985) for `O(nd)`; Myers (1986) diff and Myers (1999) bit-vector; Damerau (1964); Backurs-Indyk (2015) and Abboud-Backurs-Williams (2015) for the SETH lower bounds; Chakraborty-Das-Goldenberg-Koucký-Saks (2018) for subquadratic approximation; Schulz-Mihov (2002) for Levenshtein automata; Gusfield, *Algorithms on Strings, Trees, and Sequences*. Sibling: `13-dynamic-programming/04-edit-distance` for the DP derivation.
