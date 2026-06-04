# Word Search on a Grid — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. Correctness of the DFS Backtracking (Completeness and Soundness)
3. The No-Reuse Invariant (Distinct Cells)
4. Why In-Place Marking Is Safe (Restoration Invariant)
5. Complexity of Word Search I: O(M·N·4^L) Derivation
6. The Refined Branching Bound (3^L, not 4^L)
7. The Trie and Word Search II Correctness
8. Trie-Pruned Multi-Word Complexity
9. Comparison to Automaton / Aho-Corasick Approaches
10. Hardness: The Grid as a Constraint, and What Stays Hard
11. The Boggle (8-Direction) Variant: Bounds and Differences
12. Invariant Catalogue and Their Failure Consequences
13. The De-Duplication Subtlety, Formally
14. Quantitative Worked Comparison: Naive Loop vs Trie Sweep
15. All-Variants Complexity Ledger
16. Summary

---

## 1. Formal Definitions

Let the board be a function `B : [M] × [N] → Σ`, where `[M] = {0, …, M-1}`, `[N] = {0, …, N-1}`, and `Σ` is the alphabet (e.g. `{a, …, z}`). A **cell** is a pair `(r, c) ∈ [M] × [N]`. Let `word = w₀ w₁ … w_{L-1}` be the target string of length `L` over `Σ`.

**Definition 1.1 (Adjacency).** Two cells `(r, c)` and `(r', c')` are **orthogonally adjacent** iff `|r − r'| + |c − c'| = 1`. The four neighbors of `(r, c)` are `(r±1, c)` and `(r, c±1)` that lie in `[M] × [N]`. (The Boggle variant uses **king adjacency**: `max(|r−r'|, |c−c'|) = 1`, giving up to 8 neighbors. All results below hold with the constant 4 replaced by 8.)

**Definition 1.2 (Grid path).** A **path** of length `L` is a sequence of cells `P = (p₀, p₁, …, p_{L-1})` such that (i) consecutive cells are adjacent: `p_m` adjacent `p_{m+1}` for all `0 ≤ m < L−1`, and (ii) all cells are **distinct**: `p_a ≠ p_b` for `a ≠ b`. The distinctness condition (ii) is the **no-reuse** rule; it makes `P` a *simple* path on the grid graph.

**Definition 1.3 (Spelling).** A path `P = (p₀, …, p_{L-1})` **spells** `word` iff `B(p_m) = w_m` for every `0 ≤ m < L`.

**Definition 1.4 (Word existence).** `word` **exists** in `B` iff there is a grid path `P` of length `L` that spells `word`. Word Search I decides this predicate; the DFS of [`junior.md`](./junior.md) computes it.

**Definition 1.5 (Grid graph).** The **grid graph** `G_B = (V, E)` has vertex set `V = [M] × [N]` and an edge between every pair of orthogonally adjacent cells. A grid path (Def. 1.2) is exactly a simple path in `G_B` whose vertex labels spell `word`. This graph-theoretic framing is the bridge to the hardness discussion of Section 10.

**Notation.** Throughout, `M, N` are the grid dimensions, `L = |word|`, `Σ` the alphabet, `W` the dictionary size, `K = Σ_{w∈D} |w|` the total dictionary length (Trie size bound), and `d` the branching constant (4 orthogonal, 8 king). The "no-reuse" condition always means distinct cells; "matches" means the spelling condition of Def. 1.3.

**Worked definitions example.** On the board

```
A B
A B
```

the word `"AB"` (`L = 2`) has these spelling paths (Def. 1.2–1.3): `((0,0),(0,1))` and `((1,0),(1,1))` — two paths, each adjacent, distinct, and spelling `A,B`. The candidate `((0,0),(1,1))` is *not* a valid path because `(0,0)` and `(1,1)` are diagonal, hence not orthogonally adjacent (Def. 1.1). The candidate `((0,0),(0,0))` is excluded by distinctness (Def. 1.2(ii)). So `"AB"` **exists** in `B` (two witnesses), and `EXIST("AB")` returns `TRUE`. The word `"AA"` also exists: the two `A` cells `(0,0)` and `(1,0)` are vertically adjacent, so `((0,0),(1,0))` is a valid path spelling `A,A`. But `"AAA"` does **not** exist: a length-3 path needs 3 distinct cells whose labels are all `A`, yet only 2 cells hold `A`, so distinctness cannot be satisfied — `EXIST("AAA")` returns `FALSE`. This small example fixes the three governing conditions (adjacency, distinctness, spelling) as concrete, checkable predicates before the proofs invoke them abstractly.

---

## 2. Correctness of the DFS Backtracking (Completeness and Soundness)

The recursive procedure under analysis (in-place-marking form):

```
DFS(r, c, m):                        # try to spell w_m … w_{L-1} starting at (r,c)
  if m == L: return TRUE             # (S) all characters matched
  if (r,c) out of bounds: return FALSE
  if B(r,c) ≠ w_m: return FALSE      # (covers both mismatch and visited sentinel)
  save := B(r,c); B(r,c) := '#'      # MARK
  found := DFS(r-1,c,m+1) ∨ DFS(r+1,c,m+1) ∨ DFS(r,c-1,m+1) ∨ DFS(r,c+1,m+1)
  B(r,c) := save                     # UNMARK
  return found
EXIST(word): return ⋁_{(r,c)} DFS(r, c, 0)
```

**Theorem 2.1 (Soundness).** If `EXIST(word)` returns `TRUE`, then `word` exists in `B`.

**Proof.** `EXIST` returns `TRUE` only because some `DFS(r₀, c₀, 0)` returned `TRUE`. A call `DFS(r, c, m)` returns `TRUE` only in case (S) (`m == L`) or because one recursive child returned `TRUE`. Trace the chain of `TRUE`-returning calls from the top call down to the base case `m == L`. Each non-base call passed the test `B(r, c) = w_m` *before* marking, so it matched its character; and each recursed into an **adjacent** cell (one of the four offsets) for index `m+1`. The cell visited at depth `m` was marked `'#'` before deeper calls and is therefore distinct from every cell visited at depths `m+1, …` (those calls would fail the letter check on a `'#'` cell). Thus the sequence of cells `p₀, …, p_{L-1}` along the `TRUE` chain is adjacent, distinct, and spells `word` — a valid path by Definitions 1.2–1.3. ∎

**Theorem 2.2 (Completeness).** If `word` exists in `B`, then `EXIST(word)` returns `TRUE`.

**Proof.** Let `P = (p₀, …, p_{L-1})` be a path spelling `word`. We show `DFS(p₀, 0)` returns `TRUE`; since `EXIST` ORs over all start cells including `p₀`, the result follows. We prove by downward induction on `m` that, in the call `DFS(p_m, m)` reached with cells `p₀, …, p_{m-1}` currently marked, the call returns `TRUE`.

*Base `m = L`*: the call `DFS(·, L)` hits case (S) and returns `TRUE`. *Step*: at `DFS(p_m, m)`, the cell `p_m` is not among the marked `p₀, …, p_{m-1}` (distinctness of `P`), so `B(p_m) = w_m ≠ '#'` and the letter check passes. The call marks `p_m` and recurses into its four neighbors. Since `p_{m+1}` is adjacent to `p_m`, one of the four recursive calls is exactly `DFS(p_{m+1}, m+1)`, reached with `p₀, …, p_m` marked; by the inductive hypothesis it returns `TRUE`. The OR therefore yields `TRUE`. By induction `DFS(p₀, 0)` returns `TRUE`. ∎

**Corollary 2.3 (Decision correctness).** `EXIST(word) = TRUE ⟺ word exists in B`. The algorithm decides Word Search I exactly.

### 2.1 Worked Verification

Take the board and word from [`junior.md`](./junior.md):

```
A B C E
S F C S
A D E E
```

with `word = "ABCCED"` (`L = 6`). The successful chain of `TRUE`-returning calls is

```
DFS((0,0),0)  matches 'A', marks (0,0)
 └ DFS((0,1),1)  matches 'B', marks (0,1)
    └ DFS((0,2),2)  matches 'C', marks (0,2)
       └ DFS((1,2),3)  matches second 'C', marks (1,2)
          └ DFS((2,2),4)  matches 'E', marks (2,2)
             └ DFS((2,1),5)  matches 'D', marks (2,1)
                └ DFS(·,6)  m == L  →  TRUE   (case S)
```

Reading the marked cells in chain order gives `p = ((0,0),(0,1),(0,2),(1,2),(2,2),(2,1))`. Each consecutive pair is orthogonally adjacent (Def. 1.1), all six cells are distinct (Theorem 3.2 guaranteed this — the second `'C'` was matched at `(1,2)`, **not** the already-marked `(0,2)`), and the labels spell `ABCCED` (Def. 1.3). This is exactly the witness path whose existence Theorem 2.1 (soundness) extracts from the `TRUE` chain, and whose presence Theorem 2.2 (completeness) guarantees would be found. The empirical anchor for the inductive proofs is precisely this: every `TRUE` chain *is* a valid path, and every valid path *induces* a `TRUE` chain from its start cell.

### 2.2 The Decomposition That Makes the Induction Work

The completeness proof hinges on a **bijection** between length-`L` spelling paths from `i` and the `TRUE`-chains of `DFS(i, 0)`:

```
{spelling paths p₀=i, …, p_{L-1}}  ≅  {accepting recursion chains rooted at DFS(i,0)}.
```

Forward: a path supplies, at each depth `m`, the adjacent unmarked cell `p_{m+1}` that the OR at `DFS(p_m, m)` will try. Backward: an accepting chain reads off its marked cells in depth order to recover a path. The map is well-defined because at depth `m` exactly one cell is added (the one matched), and it is injective because distinct paths differ at some first depth, forcing distinct chains. This is the grid analogue of the prefix/last-edge decomposition used for walk counting in sibling `11-graphs/32-paths-fixed-length`, **except** that the no-reuse constraint forbids re-entering a marked cell — the structural reason the grid problem is a *simple-path* search rather than a memoryless walk (Section 10).

---

## 3. The No-Reuse Invariant (Distinct Cells)

The distinctness condition (Def. 1.2(ii)) is enforced operationally, not by an explicit set. The mechanism is the sentinel.

**Lemma 3.1 (Path cells are marked).** At any point during the execution of `DFS(r, c, m)` *after its MARK and before its UNMARK*, every cell on the current recursion path `p₀, …, p_m` (the cells of the ancestor calls plus the current one) holds the sentinel `'#'`.

**Proof.** By induction on recursion depth. The top call marks `p₀` immediately. Inductively, when `DFS(p_{m}, m)` runs its body, all ancestors `p₀, …, p_{m-1}` are marked (they are between their own MARK and UNMARK, since they are waiting on this call), and the current call marks `p_m` before recursing. ∎

**Theorem 3.2 (No reuse).** No path produced by the algorithm repeats a cell.

**Proof.** Suppose `DFS(p_{m+1}, m+1)` is a recursive child of `DFS(p_m, m)`. By Lemma 3.1, all of `p₀, …, p_m` hold `'#'`. The child's letter check `B(p_{m+1}) = w_{m+1}` requires `B(p_{m+1}) ≠ '#'` (assuming `w_{m+1} ≠ '#'`, guaranteed since the sentinel is outside `Σ`). Hence the child can only succeed on a cell **not** currently marked, i.e. distinct from all ancestors. By induction the entire successful path has distinct cells. ∎

The invariant is exactly "the cells on the current DFS path are precisely the marked cells." A separate boolean `visited` array enforces the identical invariant with `visited[r][c] = true` in place of the sentinel; the proofs are unchanged with "marked" reinterpreted as "`visited = true`."

### 3.1 Formal Equivalence of In-Place and Visited-Array Marking

**Theorem 3.3 (Marking-strategy equivalence).** Let `DFS_sentinel` be the in-place-marking procedure and `DFS_visited` the variant using a boolean `visited[r][c]` array (set true before recursion, false after), with the letter check `¬visited[r][c] ∧ B(r,c) = w_m`. For every input `(B, word)` with sentinel `'#' ∉ Σ`, the two procedures return the same result and explore the same recursion tree.

**Proof.** Define a simulation relation between the two executions: at corresponding points, `DFS_sentinel` has `B(r,c) = '#'` exactly when `DFS_visited` has `visited[r][c] = true` (for cells whose original letter is in `Σ`). This holds initially (no marks, no visits) and is preserved by each MARK (`B := '#'` ⟺ `visited := true`) and each UNMARK (`B := save` ⟺ `visited := false`), by Lemma 3.1 applied to both. The letter checks then agree: `DFS_sentinel`'s `B(r,c) = w_m` fails exactly when the cell is marked (`'#' ≠ w_m`) or genuinely mismatched, which is exactly when `DFS_visited`'s `¬visited ∧ B = w_m` fails. Identical checks at every node force identical recursion trees and identical return values. ∎

**Corollary 3.4 (When they diverge).** The simulation relation requires `'#' ∉ Σ`. If the sentinel collides with an alphabet letter, `DFS_sentinel` can match a marked cell as that letter — diverging from `DFS_visited`, which never has a collision. This is the precise formal content of the sentinel-disjointness precondition (Section 4): the `visited`-array variant is the *canonical* correct algorithm, and in-place marking is a space optimization that coincides with it **iff** the sentinel is disjoint from `Σ`. This is why, when `Σ` is unconstrained (arbitrary bytes), the `visited` array is the safe default and the in-place trick must be justified by an explicit out-of-alphabet sentinel.

---

## 4. Why In-Place Marking Is Safe (Restoration Invariant)

In-place marking reuses the board itself as the visited-state store. Safety requires that the board is **unchanged** after each top-level call so that subsequent starts and sibling branches see the original input.

**Theorem 4.1 (Restoration invariant).** For every call `DFS(r, c, m)`, the board `B` is identical immediately after the call returns to what it was immediately before the call was invoked.

**Proof (structural induction on the recursion).** *Base cases*: if `DFS` returns at `m == L`, out-of-bounds, or letter-mismatch, it does so **before** any write to `B`; the board is untouched. *Inductive step*: a non-base call performs exactly two writes to `B(r, c)` — `B(r,c) := '#'` (MARK) and `B(r,c) := save` (UNMARK), where `save` is the value read on entry. Between them it makes four recursive calls; by the inductive hypothesis each leaves the board as it found it. Therefore the only net change to `B(r, c)` across the body is `'#'` then back to `save`, and no other cell is permanently changed. The UNMARK executes on **every** path that reached the MARK (the `found` OR is evaluated, then `B(r,c) := save` runs unconditionally before `return found`). Hence on return, `B` equals its pre-call state. ∎

**Corollary 4.2 (Idempotent starts).** Each iteration of the start loop `⋁_{(r,c)} DFS(r,c,0)` begins with the original board, so the order of starts does not affect correctness, and the board emerges from `EXIST` unmodified.

### 4.1 Worked Restoration Trace

Take the small board and a *failing* attempt to make the restoration concrete. Board:

```
A B
S F
```

Attempt `word = "ABF"` starting at `(0,0)`. The board mutates during the descent and is fully restored on backtrack:

```
enter (0,0): match 'A', MARK        board = [[#,B],[S,F]]
 enter (0,1): match 'B', MARK       board = [[#,#],[S,F]]
  enter (1,1): match 'F'? need 'F' at index 2 — wait, neighbors of (0,1)
   are (0,0)='#' (blocked), (1,1)='F' (match index 2), (0,2) oob, (-1,1) oob
  enter (1,1): match 'F', MARK      board = [[#,#],[S,#]]
   enter neighbors at index 3 == L  →  TRUE
```

For `"ABF"` the word is found, and as each call returns it restores its cell:

```
return (1,1): UNMARK                board = [[#,#],[S,F]]
return (0,1): UNMARK                board = [[#,B],[S,F]]
return (0,0): UNMARK                board = [[A,B],[S,F]]   ← original restored
```

Now a *dead-end* attempt `word = "AS"` from `(0,0)`: `(0,0)='A'` matches and is marked `board = [[#,B],[S,F]]`; its neighbors are `(0,1)='B'≠'S'` and `(1,0)='S'='S'` match at index 1, then index 2 == L → TRUE, restored on the way out. But consider `word = "AX"`: `(0,0)='A'` marks, no neighbor is `'X'`, every child fails, so the UNMARK fires and `board = [[A,B],[S,F]]` — **the failed attempt leaves no trace**. This is Theorem 4.1 in action: whether the attempt succeeds or fails, the board is byte-for-byte identical afterward, which is exactly what lets the start loop try `(0,1), (1,0), (1,1)` on a pristine board after `(0,0)` is exhausted. A missing UNMARK on the `"AX"` path would leave `(0,0)='#'`, and a later start needing the `'A'` at `(0,0)` would silently fail the letter check — the canonical "forgot to unmark" bug, now visible as a violation of the restoration trace.

**Precondition (sentinel disjointness).** Theorems 3.2 and 4.1 require the sentinel `'#' ∉ Σ` (no word letter equals the sentinel). If violated, a marked cell could be matched as a real letter, breaking both no-reuse (Theorem 3.2) and, indirectly, soundness. This is the single algebraic precondition of the in-place trick; it is why the standard choice is a non-alphabet character. A separate `visited` array sidesteps the precondition entirely (no value collision is possible), at the cost of `O(M·N)` space — the formal reason a `visited` array is the safe default when `Σ` is unconstrained.

---

## 5. Complexity of Word Search I: O(M·N·4^L) Derivation

**Theorem 5.1 (Worst-case time).** `EXIST(word)` runs in `O(M·N·4^L)` time and `O(L)` auxiliary space (recursion stack).

**Proof.** *Per start cell.* Consider the recursion tree of `DFS(r, c, 0)`. Each node makes up to `d = 4` recursive calls and the tree has depth at most `L` (the index strictly increases by 1 per level and stops at `L`). A `d`-ary tree of depth `L` has at most `Σ_{m=0}^{L} d^m = O(d^L) = O(4^L)` nodes. Each node does `O(1)` work (bounds check, one character comparison, mark, unmark) excluding child calls. Hence one start costs `O(4^L)`.

*All starts.* `EXIST` launches `DFS` from each of `M·N` cells, giving `O(M·N · 4^L)`.

*Space.* The recursion depth is at most `L` (one stack frame per matched character), so auxiliary space is `O(L)` beyond the board itself; in-place marking adds `O(1)`. ∎

**Remark (why the bound is loose).** This is a worst-case upper bound, realized only by adversarial boards where the letter check rarely prunes (e.g. a board of a single repeated letter and a word of that letter). On typical inputs the letter check at the top of each call prunes the vast majority of the `4^L` tree immediately, and the no-revisit rule (Section 6) reduces the effective branching to 3. The bound is also why Word Search I is exponential **in the word length** but only linear in the grid area.

**Remark (space tightening).** The `O(L)` stack bound assumes `L ≤ M·N` (a path of distinct cells cannot exceed the cell count). Thus auxiliary space is `O(min(L, M·N))`.

### 5.1 The Adversarial Instance That Realizes the Bound

The `4^L` (or `3^L`) bound is not merely loose pessimism — it is attained on a specific family. Let `B` be the all-`'A'` board (every cell holds `'A'`) and `word = "AAA…A"` of length `L`. Then **every** letter check passes, so no branch is pruned by a mismatch; the only pruning is the no-revisit rule of Section 6. From each interior start cell the recursion explores essentially the full degree-bounded tree of self-avoiding walks of length `L`, of which there are `Θ(μ^L)` for the **connectivity constant** `μ` of the grid (`μ ≈ 2.638` for the square lattice — between the trivial lower bound and the `3` upper bound). Thus the exponential dependence on `L` is genuine, and the base sits between `2.6` and `3`, comfortably inside the `O(3^L)` envelope of Proposition 6.1. This is the precise sense in which Word Search I is *intrinsically* exponential in word length: a uniform board defeats every letter-based prune, leaving only the self-avoidance constraint, which still permits exponentially many candidate paths.

### 5.2 Why Real Inputs Are Cheap

On natural-language boards, the letter check prunes catastrophically: the probability that a random neighbor carries the required next letter is roughly `1/|Σ|` (≈ `1/26`), so the effective branching is `4/26 < 1` in expectation, and the search tree is *subcritical* — its expected size is `O(1)` per start rather than `O(3^L)`. This is the quantitative reason Word Search I runs in microseconds on real puzzles despite an exponential worst case: real words and boards diverge from the adversarial all-`'A'` instance, and each mismatch kills an entire subtree at its root. The worst-case bound and the typical-case behaviour are separated by the *letter-agreement probability*, exactly as the all-`'A'` instance (probability 1) versus a random board (probability `1/|Σ|`) demonstrates.

---

## 6. The Refined Branching Bound (3^L, not 4^L)

The naive count uses branching 4 at every level, but after the first step the cell you just came from is marked, so it is never a valid next cell.

**Proposition 6.1.** The recursion tree of one DFS start has at most `4 · 3^{L-1}` leaves (for `L ≥ 1`), giving a tighter time bound `O(M·N · 3^L)`.

**Proof.** The root call (`m = 0`) has up to 4 children (all four neighbors). Every deeper call `DFS(p_m, m)` with `m ≥ 1` was reached from its parent cell `p_{m-1}`, which is currently marked (Lemma 3.1). Of `p_m`'s four neighbors, one is `p_{m-1}` itself, whose letter check fails immediately (it holds `'#'`). So at most **3** of the four recursive calls can descend further. The tree thus has branching `4` at the root and `≤ 3` at each of the remaining `L-1` levels, bounding leaves by `4 · 3^{L-1} = O(3^L)`. ∎

This `3^L` is the bound usually quoted in careful analyses; `4^L` is the looser, more commonly cited form. Both are exponential in `L`; the distinction is a constant-base refinement, not an asymptotic class change. The Boggle (8-neighbor) variant gives `8 · 7^{L-1}` by the same argument.

**Corollary 6.2.** Even the refined bound is exponential, so Word Search I is not polynomial in `L` in the worst case. Section 10 explains why this is unavoidable: deciding whether a length-`L` simple path with a prescribed label exists is NP-hard in general graphs, and the grid does not by itself remove that hardness when `L` is unbounded.

### 6.1 Numeric Comparison of the Two Bounds

The constant-base refinement matters at scale. For a single start cell:

| `L` | `4^L` (loose) | `4 · 3^{L-1}` (tight) | ratio |
|-----|---------------|------------------------|-------|
| 1 | 4 | 4 | 1.0 |
| 4 | 256 | 108 | 2.4 |
| 8 | 65,536 | 8,748 | 7.5 |
| 12 | 16,777,216 | 708,588 | 23.7 |

The tight bound is `(4/3)·(3/4)^{·}` smaller, growing to a ~24× gap by `L = 12` — a meaningful constant-factor saving in the analysis, though both remain `Θ(exponential)`. The deeper point: neither bound is realized on natural inputs (Section 5.2), where the letter check makes the search subcritical; the realized base is the self-avoiding-walk connectivity constant `μ₄ ≈ 2.64`, smaller still. The hierarchy of bases — `4` (naive) `> 3` (no-backstep) `> μ₄ ≈ 2.64` (self-avoiding) `>` effective base on random boards (`< 1`) — is the quantitative story of why a worst-case-exponential algorithm is fast in practice.

---

## 7. The Trie and Word Search II Correctness

For a dictionary `D = {w⁽¹⁾, …, w⁽ᵂ⁾}`, build a Trie `T`: a rooted tree whose edges are labeled by letters, where the path from the root to a node spells a prefix, and a node is **terminal** for `w` iff that path spells `w`.

**Definition 7.1 (Trie correctness).** For any string `s`, descending from the root following the letters of `s` reaches a node iff `s` is a prefix of some `w ∈ D`; that node is terminal iff `s ∈ D`.

**Formal construction.** The Trie is the quotient of the set of all prefixes of `D` under the relation "spells the same string." Formally, let `Pref(D) = { s : s is a prefix of some w ∈ D }`. The node set is in bijection with `Pref(D)`; the root is the empty prefix `ε`; there is an edge labeled `a` from the node for `s` to the node for `s·a` iff `s·a ∈ Pref(D)`; and the node for `s` is terminal iff `s ∈ D`. This is well-defined because `Pref(D)` is prefix-closed (any prefix of a prefix is a prefix). The number of nodes is `|Pref(D)| ≤ 1 + Σ_{w∈D} |w| = 1 + K`, and equals that bound exactly when no two words share a non-trivial prefix. Shared prefixes collapse, so the node count is `|Pref(D)|`, which for a natural-language dictionary is far below `K` (massive prefix sharing). This `|Pref(D)|` is precisely the quantity that governs both the `O(K)` build cost (an over-estimate; the true cost is `O(|Pref(D)|)` node-touches) and the per-step `O(1)` child lookup.

**Lemma 7.1b (Descent determinism).** For any string `s ∈ Pref(D)`, the root-to-node descent following `s` is unique: at each node, the child for the next letter is unique or absent. Hence "the node spelling `s`" is well-defined, and the DFS's `child(node, letter)` is a deterministic `O(1)` (array) lookup. This determinism is what lets the grid DFS carry a *single* Trie node rather than a set of nodes — the Trie state is exactly the prefix spelled by the path so far.

The Word Search II DFS carries a Trie node alongside the cell:

```
DFS2(r, c, node):
  if (r,c) out of bounds or B(r,c)=='#': return
  next := child(node, B(r,c))
  if next == NIL: return                  # PRUNE: no word has this prefix here
  if next is terminal: report(next.word); mark next non-terminal   # de-dup
  save := B(r,c); B(r,c) := '#'           # MARK
  for each neighbor: DFS2(neighbor, next) # carry the descended node
  B(r,c) := save                          # UNMARK
EXIST_ALL(): for each cell (r,c): DFS2(r, c, root)
```

**Theorem 7.2 (Soundness of Word Search II).** Every word reported by `EXIST_ALL` exists in `B` and belongs to `D`.

**Proof.** A word `w` is reported when `DFS2` reaches a terminal node for `w`. The chain of `DFS2` calls from a start cell to this report follows, at each step, a Trie child labeled by the current cell's letter; hence the grid cells `p₀, …, p_{L-1}` along the chain have labels equal to the edge labels root→…→terminal, which spell `w`. So `w ∈ D` (terminal ⇒ in `D`, Def. 7.1) and the cells spell `w`. The marking (Lemma 3.1, Theorem 3.2 carry over verbatim — the sentinel/visited logic is unchanged) guarantees the cells are adjacent and distinct, so `P` is a valid path spelling `w`; thus `w` exists in `B`. ∎

**Theorem 7.3 (Completeness of Word Search II).** Every `w ∈ D` that exists in `B` is reported.

**Proof.** Let `w ∈ D` exist via path `P = (p₀, …, p_{L-1})`. The start loop calls `DFS2(p₀, root)`. By Definition 7.1, `child(root, B(p₀)) = child(root, w₀)` is non-NIL (since `w₀` is the first letter of `w ∈ D`), so the prune is not taken, and the descended node spells `w₀`. Inductively, at `DFS2(p_m, node_m)` where `node_m` spells `w₀…w_{m-1}`, the child for `B(p_m) = w_m` is non-NIL (it spells the prefix `w₀…w_m` of `w ∈ D`), and `p_{m+1}` (adjacent to `p_m`, distinct by `P`) is one of the four recursive targets. Descending to depth `L` reaches the terminal node for `w`, which reports `w` (unless already reported via another path — the de-dup marking only suppresses *duplicate* reports, never the first). ∎

**Corollary 7.4.** `EXIST_ALL` reports exactly the set `{ w ∈ D : w exists in B }`, each once.

The de-dup (clearing the terminal flag on first report) is necessary because the *same* word may be spelled by multiple distinct paths; without it `w` would be reported once per path. Clearing it after the first report preserves completeness (the first report fires) and soundness (no spurious words), while enforcing uniqueness.

---

## 8. Trie-Pruned Multi-Word Complexity

**Theorem 8.1 (Word Search II worst-case time).** With a Trie of `K = Σ_{w∈D} |w|` total characters and maximum word length `L_max`, `EXIST_ALL` runs in `O(M·N · d^{L_max})` time in the worst case, plus `O(K)` to build the Trie.

**Proof.** Build cost: inserting all words touches `O(K)` Trie nodes. Sweep cost: the DFS from each of `M·N` cells explores a tree of branching `≤ d` and depth `≤ L_max` (the depth at which all Trie branches terminate), bounding nodes per start by `O(d^{L_max})`; per node, the Trie child lookup is `O(1)` (array) or `O(1)` amortized (map). Total sweep `O(M·N · d^{L_max})`. ∎

**The decisive contrast with the naive loop.** Running Word Search I once per word costs `O(W · M·N · d^{L_max})` — **linear in `W`**. Word Search II is `O(M·N · d^{L_max})` — **independent of `W`** in the worst-case bound. The dictionary size enters only through the Trie build (`O(K)`, paid once) and through the *shape* of the pruned search, never as a multiplicative factor on the grid sweep. This is the formal statement of "the Trie removes the `W` factor."

**Theorem 8.2 (Output-and-prefix-sensitive bound).** The DFS only visits a `DFS2(r, c, node)` configuration where the grid cells from the start to `(r, c)` spell a **live prefix** present in the Trie. Hence the number of explored configurations is bounded by the number of (grid path, dictionary prefix) coincidences, which is at most `Σ_{prefixes s of D} (#paths in B spelling s)`. On realistic dictionaries this is far below `M·N · d^{L_max}` because most grid paths spell no dictionary prefix and are pruned at depth 1–2.

**Proof.** By prefix-existence pruning, `DFS2` returns immediately (NIL child) whenever the next cell's letter does not extend the current Trie prefix. Thus a recursive call is made only when the path-so-far spells a prefix in `D`. Summing over prefixes gives the stated bound. ∎

**Corollary 8.3 (Why pruning beats the bound).** The exponential `d^{L_max}` is realized only when the board admits exponentially many paths each spelling a live dictionary prefix — pathological. The prefix-sensitive bound (Theorem 8.2) is the honest cost on natural inputs: the search tree is the **intersection** of "all grid paths" and "the Trie," not the full `d^{L_max}` tree. Leaf pruning (detaching exhausted Trie nodes) further shrinks the live-prefix set as words are found, monotonically reducing remaining work.

### 8.1 Worked Trie-Prune Example

Take the board and dictionary from [`middle.md`](./middle.md):

```
o a a n
e t a e
i h k r
i f l v
```

with `D = {oath, pea, eat, rain}`. The Trie has root children `{o, p, e, r}`. The start loop launches a DFS only from cells whose letter is a root child:

- **`p`** never occurs on the board, so the prefix `pea` is dead at depth 0 — no start, no work. (Board-letter pruning, §4.3, would also catch this.)
- **`r`** occurs at `(2,3)`. `DFS((2,3), root→r)` looks for a neighbor spelling `ra…`; its neighbors are `n,k,v` (and out-of-bounds) — none is `'a'`, so `child(r-node, ·)` is NIL at every neighbor and the branch dies at depth 1. `rain` is not found (no `a` adjacent to the only `r`).
- **`o`** occurs at `(0,0)`. Descending `o → a → t → h` follows `(0,0)→(0,1)→(1,1)→(2,1)`, each step a live Trie child; at depth 4 the node is terminal for `oath` — reported. (This is the only `oath` path.)
- **`e`** occurs at `(1,0)` and `(1,3)`. From `(1,3)`: `e → a → t` via `(1,3)→(0,3)?` no — but `e → a` via `(0,3)='e'`? The live path `eat` is found from `(1,3)`: `(1,3)e → (0,2)?`… the actual found path is `(1,3)e → (1,2)a → (1,1)t`, terminal for `eat` — reported.

So the sweep reports `{eat, oath}`, matching the brute-force per-word oracle. Crucially, the count of explored `DFS2` configurations is dominated by the **live prefixes that actually occur on the board** (the `o…`, `e…` chains), not by `4·12 = 48` cells times `d^{L_max}`: the `p…` and most `r…`/dead branches are pruned at depth 0–1. This is Theorem 8.2 made concrete — the explored set is the intersection of grid paths and the Trie, here a handful of chains rather than the full `O(M·N·4^{L_max})` envelope.

### 8.2 The Build-vs-Sweep Cost Split, Quantified

For `D = {oath, pea, eat, rain}`, `K = 4 + 3 + 3 + 4 = 14` characters, so the Trie build touches `O(14)` node-creations (fewer after shared prefixes — here all four words have distinct first letters, so no sharing). The naive loop would run Word Search I four separate times, re-scanning all 12 start cells **four times** (48 start attempts); the Trie sweep scans the 12 cells **once** (12 start attempts), launching a DFS only from the 3 cells matching a root child (`o`, two `e`s, one `r` = 4 launches). The `W = 4` factor in start attempts (48 vs 12) is exactly the linear-in-`W` overhead the Trie removes; on a 50,000-word dictionary the same mechanism turns `50000 × 12` start attempts into `12`.

---

## 9. Comparison to Automaton / Aho-Corasick Approaches

The Trie is a multi-pattern data structure; a natural question is whether the **Aho-Corasick automaton** (Trie + failure links, the classic multi-pattern *string* matcher) applies.

### 9.1 Why Aho-Corasick does not directly transfer

Aho-Corasick matches all dictionary patterns inside a **single linear text** in `O(text + matches)` by following failure links when a character mismatches, so it never re-scans. Its power rests on the text being a **1D sequence**: after a mismatch at text position `i`, the failure link jumps to the longest proper suffix that is still a live prefix, *without moving backward in the text*.

On a **2D grid with the no-reuse constraint**, this breaks for two reasons:

1. **No single text.** A grid has exponentially many paths, not one linear string. There is no fixed scan order over which a failure-link automaton advances monotonically.
2. **Failure links assume suffix reuse.** Aho-Corasick's failure transition reuses an overlapping suffix of the *same text window*. In the grid DFS, a "mismatch" means a branch dies and we **backtrack** to try a different neighbor — there is no suffix of the current path that is a valid continuation, because continuations are constrained by adjacency and distinctness, not by string suffix structure.

Hence the grid problem uses the Trie for **prefix pruning during backtracking search**, not as a failure-link automaton over a text.

### 9.2 Where automaton ideas DO apply

| Setting | Right tool | Why |
|---------|-----------|-----|
| Many patterns in one 1D text | Aho-Corasick (`O(text + matches)`) | failure links, linear scan |
| Many patterns on a 2D grid, no reuse | Trie + DFS backtracking (this topic) | adjacency + distinctness ⇒ backtracking search |
| Counting length-`k` *walks* (reuse allowed) on a labeled graph | adjacency-matrix / automaton power | memoryless; see `11-graphs/32-paths-fixed-length` |
| Regular-language membership of a fixed string | DFA simulation | linear in the string |

The pivotal distinction is the **no-reuse (distinctness) constraint**: it makes the grid search a *simple-path* problem, which is inherently a backtracking (visited-set-tracking) computation, whereas Aho-Corasick and DFA simulation exploit the *memoryless* structure of walks/text where the only state is "current automaton node," not "set of cells used." This is the same memoryless-vs-visited-set divide that separates polynomial walk counting from #P-hard simple-path counting (sibling `11-graphs/32-paths-fixed-length`, Section 10).

### 9.3 A hybrid: Aho-Corasick along fixed lines

If the problem is relaxed to "find dictionary words along **rows, columns, and diagonals only**" (no turning, reuse along a line not an issue because each line is a 1D text), then Aho-Corasick **does** apply: run it on each of the `O(M + N)` rows/columns/diagonals as linear texts. This is a genuinely different (and easier) problem than free-form grid paths, and it is the right tool when the constraint is "straight lines" rather than "any simple path." Recognizing which variant you face is the senior judgment call.

**Why the straight-line variant is polynomial.** Along a fixed line there is exactly one scan order, so the search state is "current automaton node" — memoryless, no visited set, because the line is traversed once left-to-right and never revisits a cell. This is the **same memoryless structure** that makes walk counting polynomial: the constraint "straight line" removes the turning freedom that creates the exponential branching, collapsing the search to a single linear pass per line. Formally, the straight-line problem is in `P` (`O(total line length + matches)` via one Aho-Corasick automaton), whereas the free-form problem is exponential in `L` — the gap is precisely the turning/visited-set freedom. The senior insight: read the adjacency rule carefully. "Any adjacent cell, no reuse" ⇒ backtracking Trie DFS; "along a line" ⇒ Aho-Corasick; "reuse allowed" ⇒ matrix-power walk count. Three different complexity classes hide behind three one-word changes to the problem statement.

**Diagonal lines.** The `2(M+N)−1` diagonals (both directions) are also 1D texts; including them in the straight-line variant adds `O(diagonal length)` Aho-Corasick passes without changing the polynomial class. The total text length across all rows, columns, and both diagonal families is `O(M·N)` per orientation, so the whole straight-line solve is `O(M·N + matches)` — strictly polynomial, a sharp contrast to the free-form `O(M·N · 3^{L_max})`.

---

## 10. Hardness: The Grid as a Constraint, and What Stays Hard

**Why is Word Search I exponential in `L`?** Spelling `word` along a path of **distinct** cells is finding a labeled **simple path**. Deciding existence of a simple path of a given length/label in a general graph is NP-hard (it generalizes Hamiltonian-path-style constraints). The grid graph is more structured than an arbitrary graph, but the no-reuse constraint still forces the search to track which cells are used — a visited-set computation — and no polynomial bound in `L` is known for the worst case.

**Theorem 10.1 (Memoryless vs visited-set).** A search that may **reuse** cells (count/find *walks*) has state "current cell + characters matched," of size `O(M·N·L)`, and is solvable in polynomial time (e.g. by layered DP over `L`). A search forbidding reuse (*simple paths*, the actual Word Search problem) has state "current cell + **set of used cells**," of size `O(M·N·2^{M·N})`, and admits no known polynomial-in-`L` worst-case algorithm.

**Justification.** The walk recurrence is memoryless: the number/existence of length-`m` walks ending at `(r, c)` depends only on `(r, c)` and `m`, so it is a fixed linear/Boolean operator iterated `m` times (the matrix-power view of sibling `11-graphs/32-paths-fixed-length`). The simple-path recurrence must remember the visited set to enforce distinctness, blowing the state to `2^{M·N}` subsets — the same structural reason simple-path counting is #P-hard while walk counting is polynomial. Word Search backtracking *is* the exponential-state search, made tolerable in practice by aggressive pruning, not by a better worst-case bound. ∎

**What the grid structure does buy.** Planarity and bounded degree (4) make the constant base small (`3^L`, Section 6) and make many pruning heuristics extremely effective, but they do not change the worst-case exponential dependence on `L`. For *fixed small* `L`, the problem is polynomial (`O(M·N · 3^L)` with `L` constant), which is why Word Search is "easy" in practice: real words are short.

**Contrast with the multi-word case.** Word Search II's complexity (Section 8) is **not worse** than single-word in the grid factor — the Trie sweep is `O(M·N · d^{L_max})` regardless of `W`. The dictionary makes the problem *bigger* (more words to find) but the pruning makes it *cheaper per word* by sharing prefixes; the hardness ceiling is still the single-path exponential in `L_max`, unchanged by adding words.

### 10.1 The Reduction Sketch (Why Unbounded `L` Is NP-Hard)

To see the hardness concretely, consider the **decision** problem: given a board, a word, and the requirement that the path visit *every* cell exactly once (a Hamiltonian constraint), does a spelling path exist? On an all-distinct-letters board where `word` is a fixed permutation forcing a Hamiltonian traversal, this is exactly the Hamiltonian-path problem on the grid graph `G_B` (Def. 1.5). Hamiltonian path on grid graphs is **NP-complete** (Itai-Papadimitriou-Szwarcfiter 1982), so the labeled-simple-path existence problem with unbounded `L` is NP-hard. Word Search I with `L = M·N` is therefore not solvable in polynomial time unless P = NP. The backtracking DFS is, in this light, a Hamiltonian-path search specialized to spelling constraints — its exponential worst case is inherited from the NP-hardness of the underlying simple-path problem, not an artifact of a naive algorithm.

### 10.2 Why Short Words Escape the Hardness

The NP-hardness requires `L` to grow with `M·N`. For **fixed** `L` (real words: `L ≤ ~15`), the problem is in P: `O(M·N · 3^L)` is polynomial in `M·N` with `3^L` a (large but) constant. This is the formal statement of "Word Search is easy in practice" — it is **fixed-parameter** behaviour in `L`. The exponential lives entirely in the parameter `L`, and real dictionaries cap `L` at a small constant. The same dichotomy governs the multi-word case: `L_max` is the parameter, and natural dictionaries keep it small, so the `d^{L_max}` factor is a constant and the Trie sweep is effectively linear in the grid area. The honest one-line takeaway: *Word Search is exponential in word length but polynomial in everything else, and word length is small, so it is fast.*

### 10.3 What Cannot Be Salvaged by Cleverness

No reformulation removes the visited-set state for unbounded `L`: any algorithm correct on all instances must, in the worst case, distinguish exponentially many partial paths that agree on their current cell but differ in their visited sets (else it would conflate a reusable continuation with a forbidden one). This is the same obstruction that blocks a memoryless (matrix-power) solution: the transition operator is **not** a fixed linear map on a small space because its validity depends on the unbounded visited history. Hence pruning — not a better asymptotic algorithm — is the only lever, and the practical art (Sections 4 of [`senior.md`](./senior.md)) is choosing prunes that collapse the visited-set blowup on the inputs you actually face.

### 10.4 The Parameterized Landscape

The dependence on `L` is sharper than "exponential": Word Search I is **fixed-parameter tractable (FPT)** in `L`, and the multi-word case is FPT in `L_max`. The landscape, parameterized by the path length rather than the grid size:

| Problem | Complexity | Parameter | In which class |
|---------|-----------|-----------|----------------|
| Word exists, length `L` | `O(M·N · 3^L)` | `L` | FPT in `L` (P for fixed `L`) |
| All dictionary words | `O(K + M·N · 3^{L_max})` | `L_max` | FPT in `L_max` |
| Spelling path length `L = M·N` (Hamiltonian) | NP-hard | none small | NP-hard |
| Longest spelling simple path | NP-hard | — | NP-hard (longest path generalization) |
| Count spelling simple paths of length `L` | `#P`-hard for large `L` | `L` | hard like simple-path counting |
| Count spelling **walks** of length `L` (reuse) | `O(M·N · L)` | — | P (memoryless) |

The first two rows (the actual Word Search problems) are FPT: the exponential is confined to the parameter `L`/`L_max`, which natural dictionaries keep at a small constant (`≤ 15`), so the methods are polynomial-time *in practice* with a constant `3^{L_max}` factor. The hardness rows show what happens when the parameter grows with the input: at `L = M·N` the problem becomes the NP-hard Hamiltonian-spelling problem (§10.1). The final row is the polynomial *walk* relative — the same grid, the same labels, but with reuse allowed, collapsing the visited-set state to a memoryless one. The entire topic sits at the FPT sweet spot: worst-case-exponential, but with the exponent under tight practical control because real words are short.

**FPT formal note.** A problem is FPT in parameter `k` if it is solvable in `f(k) · poly(n)` time for some function `f`. Here `f(L) = 3^L` (or `4^L`) and `poly(M·N) = M·N`, so Word Search I is `O(3^L · M·N)` — FPT with `f(L) = 3^L`. This is the formal statement that "the grid size enters polynomially; only the word length enters exponentially," and it is the precise reason the worst-case intractability never bites on real inputs.

---

## 11. The Boggle (8-Direction) Variant: Bounds and Differences

The Boggle variant replaces orthogonal adjacency with **king adjacency** (Def. 1.1): every cell has up to 8 neighbors. Every theorem above transfers with the constant `4` replaced by `8`, but the bounds and the practical behaviour shift in ways worth making precise.

**Proposition 11.1 (Boggle branching).** A Boggle DFS start explores a tree with branching `8` at the root and `≤ 7` at each deeper level (the cell just came from is marked), giving `8 · 7^{L-1} = O(7^L)` leaves per start and `O(M·N · 7^L)` total.

**Proof.** Identical to Proposition 6.1: at depth `m ≥ 1`, one of the 8 neighbors is the marked predecessor `p_{m-1}`, whose check fails; the remaining `≤ 7` may descend. ∎

**Corollary 11.2 (Self-avoiding-walk base).** The realized worst case (all-equal board) is `Θ(μ₈^L)` where `μ₈` is the connectivity constant of the king-move lattice (`μ₈ ≈ 4.5` empirically), strictly between the trivial bound and `7`. So Boggle is exponential with a larger base than orthogonal Word Search, matching intuition: more directions means a denser self-avoiding-walk tree.

**Difference 1 — minimum length.** Boggle scores only words of length `≥ 3`; words shorter than 3 are never inserted into the Trie, pruning the search at the root for short prefixes that lead only to too-short words. This is a *correctness* filter, not just an optimization, when the rules forbid short words.

**Difference 2 — `Qu` tile.** Physical Boggle has a single `Qu` tile. Formally this is an alphabet over *strings* (one tile spells two letters), handled by letting a tile match a two-character Trie descent in one grid step. The mark/unmark and restoration invariants are unchanged (one grid cell is marked), but the Trie descent advances by two characters when crossing a `Qu` tile — a clean generalization of the descent map (Lemma 7.1b) to tiles labeled by short strings.

**Difference 3 — same Trie engine.** Despite the larger branching, Boggle uses the *identical* Trie sweep; only the direction set, the length filter, and the scoring map differ. The complexity is `O(K + M·N · 7^{L_max})`, again **independent of `W`**, and the prefix-sensitive bound (Theorem 8.2) applies verbatim — the search is the intersection of king-move grid paths and the Trie.

**Scoring as a post-pass.** The score is `Σ_{w found} score(|w|)` for the length→points map; since `EXIST_ALL` already de-duplicates (Corollary 7.4), each found word contributes its points once. Scoring is `O(#found)` after the sweep and does not affect the asymptotic search cost.

---

## 12. Invariant Catalogue and Their Failure Consequences

The correctness of every variant rests on a small set of invariants. Cataloguing them — and the precise consequence of breaking each — is the practical distillation of Sections 2–8.

| Invariant | Statement | Maintained by | If broken |
|-----------|-----------|---------------|-----------|
| **Path-marked** (Lemma 3.1) | marked cells = current path cells | MARK before recursion | reuse becomes possible; soundness fails |
| **No-reuse** (Theorem 3.2) | every reported path has distinct cells | sentinel/visited check refuses marked cells | invalid paths reported (e.g. zig-zag between two cells) |
| **Restoration** (Theorem 4.1) | board unchanged after each call | UNMARK on every return path | later starts see corrupted board; completeness fails |
| **Sentinel-disjoint** (§4 precond.) | `'#' ∉ Σ` | choose non-alphabet sentinel | marked cell matched as a letter; both safety properties fail |
| **Trie-descent** (Lemma 7.1b) | carried node spells path prefix | descend `child(node, letter)` each step | wrong words reported / missed |
| **De-dup** (Corollary 7.4) | each found word reported once | clear terminal flag on first report | duplicate reports (one per path) |

**Theorem 12.1 (Conjunction suffices).** If all six invariants hold throughout an execution, then `EXIST` (resp. `EXIST_ALL`) is sound and complete.

**Proof.** Path-marked + no-reuse + sentinel-disjoint give the distinct-cell property of every reported path (Theorem 3.2); restoration gives independence of starts (Corollary 4.2), so completeness's "try every start" is valid (Theorem 2.2); Trie-descent gives that reported words equal path labels and are in `D` (Theorem 7.2); de-dup gives uniqueness. Together these are exactly the hypotheses of Corollaries 2.3 and 7.4. ∎

**Corollary 12.2 (Minimal test set).** A test suite that checks (a) board-unchanged-after-solve, (b) no-duplicate-reports, (c) every-reported-word-in-`D`, and (d) every-reported-path-distinct-and-adjacent, exercises all six invariants and therefore certifies correctness on the tested instances. This is the formal justification for the brute-force-oracle + invariant battery prescribed in [`senior.md`](./senior.md) §8.

---

## 13. The De-Duplication Subtlety, Formally

Word Search II's de-dup (clear the terminal flag on first report) interacts subtly with the multiplicity of spelling paths. Two clarifying results:

**Proposition 13.1 (Path multiplicity).** A single word `w ∈ D` may be spelled by `Ω(d^{|w|})` distinct grid paths in the worst case (e.g. an all-equal board and a uniform word). Without de-dup, `EXIST_ALL` would report `w` once per path — exponentially many times.

**Proof.** On the all-`'A'` board with `w = "AA…A"`, every self-avoiding walk of length `|w|` from a matching start spells `w`; there are `Θ(μ^{|w|})` of them (Section 5.1). Each reaches the terminal node and, absent de-dup, fires a report. ∎

**Proposition 13.2 (De-dup preserves correctness).** Clearing the terminal flag on first report changes the *multiset* of reports to a *set* without removing any word that exists.

**Proof.** The first time the terminal node for `w` is reached, `w` is reported and the flag cleared; subsequent reaches find the flag clear and do not report. Since `w` is reached at least once iff `w` exists (completeness, Theorem 7.3), exactly one report fires per existing `w`. No word is lost (the first report always fires) and none is duplicated (later reports are suppressed). ∎

**Remark (set-based alternative).** Equivalently, collect reports into a `set` keyed by the word; this is the **immutable-Trie** strategy of [`senior.md`](./senior.md) §2.2, required when the Trie is shared read-only across concurrent solves. The two strategies (clear-flag vs external-set) are observationally equivalent on output; they differ only in whether the Trie is mutated, which matters for concurrency and reuse, not for the reported set.

**Corollary 13.3 (Counting words found).** To count *how many* dictionary words appear (not which), increment a counter on each first report (or take `|set|`). By Proposition 13.2 this counts each existing word once, giving `|{w ∈ D : w exists in B}|` exactly — the quantity computed by Challenge 3 of [`interview.md`](./interview.md).

---

## 14. Quantitative Worked Comparison: Naive Loop vs Trie Sweep

To make the `W`-factor removal concrete, fix `M = N = 12` (so `M·N = 144`), `L_max = 8`, `d = 4`, and compare the worst-case operation counts as `W` grows. The naive loop is `W · M·N · d^{L_max}`; the Trie sweep is `K + M·N · d^{L_max}` with `K ≈ W · L_avg` (here `L_avg ≈ 5`).

| `W` | `K ≈ 5W` | Naive: `W·144·4^8` | Trie sweep: `K + 144·4^8` | Ratio (naive / sweep) |
|------|----------|---------------------|----------------------------|------------------------|
| 1 | 5 | `9.4 × 10⁶` | `9.4 × 10⁶` | ~1× |
| 10 | 50 | `9.4 × 10⁷` | `9.4 × 10⁶` | ~10× |
| 100 | 500 | `9.4 × 10⁸` | `9.4 × 10⁶` | ~100× |
| 1,000 | 5,000 | `9.4 × 10⁹` | `9.4 × 10⁶` | ~1,000× |
| 50,000 | 250,000 | `4.7 × 10¹¹` | `9.6 × 10⁶` | ~49,000× |

The sweep column is essentially **flat** in `W` (the `144·4^8` grid-sweep term dominates the linear `K` build term until `W` is enormous), while the naive column scales **linearly** in `W`. The ratio is exactly the `W`-factor that Theorem 8.1 predicts. Two caveats keep this honest:

1. **The `4^8` factor is the loose worst case.** Theorem 8.2's prefix-sensitive bound means the real sweep cost is `144 ×` (number of live-prefix grid paths), typically orders of magnitude below `4^8 = 65536`. The *ratio* between naive and sweep is robust to this because both share the same `d^{L_max}` envelope — the sweep simply pays it once instead of `W` times.
2. **`K` is paid once.** In a service answering many boards, the Trie build (`O(K)`) amortizes across all boards, so its contribution to per-board cost is zero. This is the formal basis for "build the Trie once, share read-only" ([`senior.md`](./senior.md) §2.1).

**Derivation of the crossover.** The naive loop overtakes the sweep when `W · C ≥ K + C` where `C = M·N·d^{L_max}`, i.e. `W ≥ 1 + K/C`. Since `K ≪ C` for any realistic dictionary (`K` is linear in `W·L_avg`; `C` is the exponential grid-sweep term), the crossover is essentially `W = 2`: the Trie sweep wins as soon as there are **two or more words**. For a single word the two are equal (both `≈ C`), and the naive single-word search is simpler — hence the rule "one word → Word Search I; two or more → Word Search II."

---

## 15. All-Variants Complexity Ledger

A consolidated ledger of every variant discussed, with the governing parameter and the tight-vs-loose status of each bound.

| Variant | Time (worst case) | Tight base | Governing parameter | Notes |
|---------|-------------------|-----------|---------------------|-------|
| Word Search I (4-dir) | `O(M·N · 3^L)` | `μ₄ ≈ 2.64` (SAW) | `L` (word length) | `4^L` is the loose textbook form |
| Word Search I (8-dir / Boggle) | `O(M·N · 7^L)` | `μ₈ ≈ 4.5` (SAW) | `L` | larger base, same shape |
| Word Search II (4-dir) | `O(K + M·N · 3^{L_max})` | prefix-sensitive | `L_max`, independent of `W` | Theorem 8.1 |
| Word Search II (Boggle) | `O(K + M·N · 7^{L_max})` | prefix-sensitive | `L_max` | scoring is `O(#found)` post-pass |
| Naive multi-word loop | `O(W · M·N · d^{L_max})` | — | `W · L_max` | linear in `W` — avoid |
| Straight-line matching | `O(lines·len + matches)` | tight | text length | Aho-Corasick, no backtracking |
| Walks (reuse allowed) | `O(M·N · L)` per source | tight (polynomial) | `L` | memoryless; matrix-power, NOT this topic |
| Hamiltonian spelling (`L = M·N`) | NP-hard | — | `M·N` | reduction in §10.1 |

The two rows that bracket the topic are the last two: **walks** (reuse allowed) are polynomial because the recurrence is memoryless, while the **Hamiltonian** extreme (`L = M·N`) is NP-hard. Word Search lives between them — exponential in `L` but with `L` typically a small constant, which is the entire reason a worst-case-intractable problem is trivially fast on real inputs. Every other row is a re-parameterization of this same `(grid factor) × (exponential-in-path-length factor)` product, with the multi-word rows distinguished only by whether the `W` factor is paid (naive) or removed by prefix sharing (Trie).

---

## 16. Summary

- **Correctness.** The mark/explore/unmark DFS is **sound** (every returned match is a valid distinct-cell, adjacent, spelling path — Theorem 2.1) and **complete** (every existing word is found — Theorem 2.2), so it decides Word Search I exactly.
- **No-reuse invariant.** "Marked cells = current path cells" (Lemma 3.1); the letter/sentinel check refuses any marked cell, guaranteeing distinct cells (Theorem 3.2). A `visited` array enforces the identical invariant.
- **In-place marking safety.** The **restoration invariant** (Theorem 4.1): every call leaves the board exactly as it found it, because MARK and UNMARK bracket the body and run on every return path. The one precondition is the sentinel being outside the alphabet; a `visited` array removes even that.
- **Word Search I complexity.** `O(M·N · 4^L)` time (loose) / `O(M·N · 3^L)` (tight, since you never step back to the previous cell — Proposition 6.1), `O(min(L, M·N))` stack space. Exponential in word length, linear in grid area.
- **Word Search II correctness.** Carrying a Trie node yields exactly `{w ∈ D : w exists in B}`, each once (Corollary 7.4); de-dup is required because one word may have multiple spelling paths.
- **Multi-word complexity.** `O(K)` to build the Trie plus `O(M·N · d^{L_max})` to sweep — **independent of `W`** (Theorem 8.1), versus `O(W · M·N · d^{L_max})` for the naive loop. The honest cost is the **prefix-sensitive** bound (Theorem 8.2): the search is the intersection of grid paths and the Trie.
- **Automaton comparison.** Aho-Corasick matches many patterns in **one 1D text** via failure links; it does not transfer to free-form 2D grid paths because the no-reuse constraint makes the search a simple-path (visited-set) computation, not a memoryless scan. It *does* apply to the easier "straight-line only" variant.
- **Refined branching.** The `4^L` bound is loose; the true branching is `4` at the root and `≤ 3` deeper (the predecessor cell is marked), giving `O(M·N · 3^L)` (Proposition 6.1), and the realized worst case is `Θ(μ^L)` with the lattice connectivity constant `μ ≈ 2.64` (4-dir) or `4.5` (8-dir) on an all-equal board (§5.1).
- **Typical vs worst.** On natural boards the letter check prunes with probability `≈ 1 − 1/|Σ|` per neighbor, making the search subcritical (`O(1)` expected per start, §5.2); the exponential is realized only by adversarial uniform inputs.
- **Trie formalism.** The Trie is the prefix-closed set `Pref(D)` with terminal nodes at `D`; descent is deterministic (Lemma 7.1b), which is why the DFS carries a single node equal to the path's prefix.
- **De-dup is essential.** A word may be spelled by `Ω(d^{|w|})` paths (Proposition 13.1); clearing the terminal flag (or using an external set) reduces the report multiset to a set without losing any existing word (Proposition 13.2).
- **Crossover.** The Trie sweep beats the naive loop as soon as `W ≥ 2` (§14): both are `≈ C = M·N·d^{L_max}` for one word, but the naive loop pays `W·C` while the sweep pays `K + C ≈ C`.
- **Invariant catalogue.** Six invariants (path-marked, no-reuse, restoration, sentinel-disjoint, Trie-descent, de-dup) jointly imply soundness and completeness (Theorem 12.1); a four-check test battery exercises all six (Corollary 12.2).
- **Hardness.** The no-reuse constraint is the source of the exponential-in-`L` worst case: simple-path search needs visited-set state (`2^{M·N}`), unlike memoryless walk search (polynomial). Hamiltonian spelling (`L = M·N`) is NP-hard on grid graphs (§10.1); for fixed small `L` the problem is in P (`O(M·N·3^L)`, §10.2). Pruning, not a better bound, is what makes the problem tractable; short real words keep `L` small.

### Complexity Cheat Table

| Task | Method | Time | Space |
|------|--------|------|-------|
| Word exists (Word Search I) | DFS backtracking | `O(M·N · 3^L)` (≤ `4^L`) | `O(min(L, M·N))` |
| All dictionary words (Word Search II) | Trie + single DFS | `O(K + M·N · d^{L_max})` | `O(K + L_max)` |
| Naive multi-word | Word Search I per word | `O(W · M·N · d^{L_max})` | `O(L_max)` |
| Boggle (8-dir) | Trie + DFS | `O(K + M·N · 7^{L_max})` | `O(K + L_max)` |
| Words along straight lines only | Aho-Corasick per line | `O(lines·len + matches)` | `O(K)` |
| Hamiltonian spelling (`L = M·N`) | DFS backtracking | NP-hard | `O(M·N)` |
| Walks (reuse allowed) | layered DP / matrix power | `O(M·N · L)` poly | `O(M·N)` |

### Closing Notes

- **The single pivot** (Section 10): the *no-reuse (distinct cells)* constraint is the dividing line. With reuse, the problem is a memoryless walk — polynomial via matrix power (sibling `11-graphs/32-paths-fixed-length`). Without reuse, it is a simple-path search — exponential in `L`, NP-hard at `L = M·N`. Every complexity claim in this document traces back to this one constraint.
- **The Trie removes `W`, not the exponential** (Sections 8, 14): Word Search II shares dictionary prefixes so the grid is swept once, eliminating the linear-in-`W` re-scanning of the naive loop. It does **not** lower the `d^{L_max}` ceiling — that ceiling is the single-path exponential, unchanged by adding words.
- **In-place marking is an optimization, not a necessity** (Section 4): it saves `O(M·N)` space and is safe by the restoration invariant given a disjoint sentinel; a `visited` array is the equally-correct, alphabet-agnostic, concurrency-friendly alternative.
- **Pruning is the only practical lever** (Section 10.3): no reformulation removes the visited-set blowup for unbounded `L`, so engineering effort goes into prunes (prefix-existence, board-letter, leaf, start-cell) that collapse the blowup on real inputs — the subject of [`senior.md`](./senior.md) §4.
- **Bounds are loose by design** (Sections 5–6, 8): the textbook `4^L` / `d^{L_max}` figures are worst-case envelopes realized only on adversarial uniform inputs; the honest cost is the self-avoiding-walk base `μ^L` and the prefix-sensitive intersection bound, both far smaller on natural boards and dictionaries.

Foundational references: depth-first search and backtracking (CLRS); Trie / prefix tree theory and DAWG/DAFSA minimization (Daciuk, Mihov, Watson, Watson 2000); Aho-Corasick (*Efficient string matching: an aid to bibliographic search*, 1975); simple-path / Hamiltonian hardness (Garey-Johnson; Itai-Papadimitriou-Szwarcfiter 1982 for grid graphs); self-avoiding-walk connectivity constants (Madras-Slade, *The Self-Avoiding Walk*); and the memoryless-vs-visited-set divide developed in sibling `11-graphs/32-paths-fixed-length` (walks vs simple paths, #P-hardness). Sibling backtracking topics in `16-backtracking` share the mark/explore/unmark correctness template proved here.
