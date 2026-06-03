# Longest Common Subsequence and Longest Increasing Subsequence — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions (subsequence, substring, common-subsequence, transitivity)
2. The LCS Optimal-Substructure Theorem (Proof, monotonicity, worked verification)
3. The LCS Dynamic Program and Its Correctness (counting distinct optima)
4. Reconstruction and the Edit-Distance Relation (indel duality, the edit graph, Myers)
5. The LIS Optimal-Substructure Theorem (Proof, LIS-as-LCS, parameterized landscape)
6. Correctness of the Patience / Binary-Search LIS (sortedness, reconstruction, poset chains)
7. Patience Sorting, Dilworth's Theorem, and the RSK Connection (Erdős–Szekeres)
8. The LCS ↔ LIS Reduction for Permutations (Proof, Hunt–Szymanski ordering)
9. Hirschberg's Algorithm: Correctness and Complexity (midline split, cost accounting)
10. Longest Common Substring: A Different Recurrence (suffix-structure speedup)
11. Lower Bounds and Hardness (SETH barrier, escapes, numerical notes)
12. Summary

---

## 1. Formal Definitions

**Definition 1.1 (Sequence, subsequence).** A sequence `X = (x_1, …, x_n)` over an alphabet `Σ`. A **subsequence** of `X` is `(x_{i_1}, …, x_{i_k})` for indices `1 ≤ i_1 < i_2 < … < i_k ≤ n`. The order is inherited; gaps are allowed. The empty sequence (`k = 0`) is a subsequence of every sequence.

**Definition 1.2 (Substring / factor).** A **substring** of `X` is a *contiguous* subsequence `(x_i, x_{i+1}, …, x_{i+ℓ-1})`. Every substring is a subsequence; the converse fails.

**Definition 1.3 (Common subsequence, LCS).** `Z` is a **common subsequence** of `X` and `Y` if `Z` is a subsequence of both. The **longest common subsequence** problem asks for a common subsequence of maximum length; we write `lcs(X, Y)` for that length. The maximizer need not be unique.

**Definition 1.4 (Increasing subsequence, LIS).** Given `A = (a_1, …, a_n)`, an **increasing subsequence** is a subsequence `(a_{i_1}, …, a_{i_k})` with `a_{i_1} < a_{i_2} < … < a_{i_k}` (**strict**), or `≤` throughout (**non-decreasing**). `lis(A)` denotes the maximum length.

**Notation conventions.** Throughout, `n = |X|`, `m = |Y|`; `dp[i][j]` is the LCS length of the length-`i` prefix of `X` and length-`j` prefix of `Y`; `L_i` is the LIS length of an increasing subsequence ending at index `i`; `tails[k]` is the smallest tail of any length-`(k+1)` increasing subsequence; the Iverson bracket `[P]` is `1` if `P` holds else `0`. "Subsequence" always permits gaps; "substring" never does. We prove the strict-LIS results; the non-decreasing variant follows by replacing `<` with `≤` and `lower_bound` with `upper_bound`, noted where it matters.

**Remark.** The subsequence/substring distinction (Def. 1.1 vs 1.2) is the crux of the topic, exactly as walks-vs-simple-paths was for graph powers: LCS (gaps allowed) is `O(nm)` and reconstructs cleanly, whereas the *contiguous* variant has a different recurrence (Section 10), and the *subsequence* problem is what enables the LIS reduction (Section 8).

**Counting subsequences.** A sequence of length `n` has `2^n` subsequences (each element kept or dropped), but at most `2^n` *distinct* ones (fewer if there are repeats — the exact count of distinct subsequences is itself a DP: `f(i) = 2·f(i-1) − f(last[x]-1)`, subtracting double-counted prefixes). This exponential count is why brute-force LCS (enumerate all subsequences of one string, test each against the other) is `O(2^{min(n,m)} · max(n,m))` and only viable as an oracle. The DP's power is collapsing this exponential search into `O(nm)` by the optimal-substructure of Theorem 2.1 — it never enumerates subsequences, it composes prefix-LCS values.

**Lemma 1.5 (Subsequence transitivity).** If `Z` is a subsequence of `Y` and `Y` is a subsequence of `X`, then `Z` is a subsequence of `X`. (Compose the two index-injections.) Hence "is a subsequence of" is a partial order on sequences, and an LCS is a maximal lower bound (in length) of two sequences under this order — the order-theoretic framing that connects LCS to lattice/meet structure and motivates the Hasse-diagram view of the alignment DAG.

**Note on uniqueness.** Neither LCS nor LIS is unique in general: there can be many common subsequences of maximum length, and many increasing subsequences of maximum length. The algorithms return *one* witness determined by their tie-break. When a problem says "the LCS" it means "any LCS"; when it says "all LCS" it is asking for the exponential enumeration of Section 3.1. Pinning this down at the spec level avoids a class of confusion.

---

## 2. The LCS Optimal-Substructure Theorem (Proof)

Let `X_i = (x_1, …, x_i)` denote the length-`i` prefix.

**Theorem 2.1 (Optimal substructure).** Let `Z = (z_1, …, z_k)` be any LCS of `X_n` and `Y_m`.

1. If `x_n = y_m`, then `z_k = x_n = y_m` and `Z_{k-1}` is an LCS of `X_{n-1}` and `Y_{m-1}`.
2. If `x_n ≠ y_m` and `z_k ≠ x_n`, then `Z` is an LCS of `X_{n-1}` and `Y_m`.
3. If `x_n ≠ y_m` and `z_k ≠ y_m`, then `Z` is an LCS of `X_n` and `Y_{m-1}`.

**Proof.**

*(1)* Suppose `x_n = y_m =: c`. First we show some LCS ends in `c`. If `z_k ≠ c`, append `c` to `Z`: it is still a subsequence of both `X_n` (using position `n`) and `Y_m` (using position `m`), giving a *longer* common subsequence — contradicting maximality. So `z_k = c`. Now `Z_{k-1}` is a common subsequence of `X_{n-1}` and `Y_{m-1}` (the matched `c` used the last positions). If `Z_{k-1}` were *not* a longest such, take a longer common subsequence `W` of `X_{n-1}, Y_{m-1}` and append `c`: this beats `Z`, contradiction. Hence `Z_{k-1}` is an LCS of `X_{n-1}, Y_{m-1}`.

*(2)* Suppose `x_n ≠ y_m` and `z_k ≠ x_n`. Then `Z` does not use position `n` of `X`, so `Z` is a common subsequence of `X_{n-1}` and `Y_m`. If a longer common subsequence of `X_{n-1}, Y_m` existed, it would also be a common subsequence of `X_n, Y_m` (extending the alphabet of allowed positions), contradicting that `Z` is an LCS of `X_n, Y_m`. So `Z` is an LCS of `X_{n-1}, Y_m`. *(3)* is symmetric (swap the roles of `X` and `Y`). ∎

**Remark (why the swap argument is necessary).** Case (1) crucially uses a *non-constructive* existence claim ("some optimal LCS ends in `c`") established by an exchange/swap argument, not by inspecting a specific LCS. This is the recurring proof technique for optimal-substructure results: assume an optimum lacks the desired property, modify it into one that has the property without losing optimality, contradiction. The same pattern proves the LIS recurrence (Section 5) and the patience invariant (Section 6). Recognizing it lets you derive new DP recurrences (e.g. for variants) by asking "what swap preserves optimality here?"

**Corollary 2.2 (Recurrence).** Writing `c[i][j] = lcs(X_i, Y_j)`:

```
c[i][j] = 0                              if i = 0 or j = 0
c[i][j] = c[i-1][j-1] + 1                if i,j > 0 and x_i = y_j
c[i][j] = max(c[i-1][j], c[i][j-1])      if i,j > 0 and x_i ≠ y_j
```

**Proof.** The base cases are immediate (an empty prefix has only the empty common subsequence). For `x_i = y_j`, Theorem 2.1(1) gives `c[i][j] = c[i-1][j-1] + 1` (the matched character contributes 1, the rest is the diagonal subproblem). For `x_i ≠ y_j`, Theorem 2.1(2,3) say the LCS equals the LCS of one of the two reduced instances; taking the larger covers both cases, and neither can exceed it, so `c[i][j] = max(c[i-1][j], c[i][j-1])`. ∎

### 2.1 Worked Verification of the Recurrence

Take `X = "AGCAT"`, `Y = "GAC"`. The full table (rows `i = 0..5`, columns `j = 0..3`):

```
        ∅   G   A   C
   ∅    0   0   0   0
   A    0   0   1   1
   G    0   1   1   1
   C    0   1   1   2
   A    0   1   2   2
   T    0   1   2   2
```

Check `c[3][3]`: `x_3 = 'C' = y_3 = 'C'`, a match, so `c[3][3] = c[2][2] + 1 = 1 + 1 = 2` — consistent with Theorem 2.1(1). Check `c[2][2]`: `x_2 = 'G' ≠ y_2 = 'A'`, mismatch, so `c[2][2] = max(c[1][2], c[2][1]) = max(1, 1) = 1` — Theorem 2.1(2,3). The corner `c[5][3] = 2` is `lcs("AGCAT", "GAC")`, witnessed by the common subsequence `"AC"`. A brute-force enumeration of all `2^3 = 8` subsequences of the shorter string `"GAC"` confirms the longest one present in `"AGCAT"` has length 2, anchoring the inductive proof empirically.

### 2.2 Monotonicity of the LCS Table

**Proposition 2.3 (Lipschitz / monotone structure).** For all `i, j`: (a) `c[i][j] ≥ c[i-1][j]` and `c[i][j] ≥ c[i][j-1]` (monotone non-decreasing in each prefix length); (b) `c[i][j] ≤ c[i-1][j] + 1` and `c[i][j] ≤ c[i][j-1] + 1` (each cell exceeds its top/left neighbor by at most 1); (c) the diagonal differences satisfy `c[i][j] − c[i-1][j-1] ∈ {0, 1, 2}` with the value `2` impossible.

**Proof.** *(a)* Extending a prefix can only add candidate common subsequences, never remove them. *(b)* A common subsequence of `(X_i, Y_j)` uses `x_i` at most once; deleting that use gives a common subsequence of `(X_{i-1}, Y_j)` shorter by at most 1, so `c[i][j] ≤ c[i-1][j] + 1`. *(c)* From the recurrence: on a match `c[i][j] = c[i-1][j-1]+1` (difference exactly 1); on a mismatch `c[i][j] = max(c[i-1][j], c[i][j-1]) ≤ c[i-1][j-1] + 1` by applying (b) twice, and `≥ c[i-1][j-1]` by (a), so the diagonal jump is 0 or 1, never 2. ∎

This monotonicity is exactly what licenses the traceback to follow a value-preserving or value-decreasing path back to the origin, and it is the structural fact the Hunt–Szymanski "contour" / dominant-match formulation exploits: the table partitions into level sets (contours) `{(i,j) : c[i][j] = ℓ}` whose boundaries are staircases, and the LCS length is the number of contours crossed.

---

## 3. The LCS Dynamic Program and Its Correctness

**Algorithm.**
```
LCS-LENGTH(X, Y):
  for i in 0..n: c[i][0] = 0
  for j in 0..m: c[0][j] = 0
  for i in 1..n:
    for j in 1..m:
      if x_i = y_j: c[i][j] = c[i-1][j-1] + 1
      else:         c[i][j] = max(c[i-1][j], c[i][j-1])
  return c[n][m]
```

**Theorem 3.1 (Correctness).** `LCS-LENGTH` returns `lcs(X, Y)`.

**Proof.** By induction on `i + j` using Corollary 2.2: each cell `c[i][j]` is computed from cells with strictly smaller `i + j` (top, left, top-left), all of which equal the true LCS lengths of their subproblems by the inductive hypothesis. The base row/column are correct by definition. Hence `c[n][m] = lcs(X_n, Y_m)`. ∎

**Theorem 3.2 (Complexity).** `LCS-LENGTH` runs in `Θ(nm)` time and `Θ(nm)` space; the space is reducible to `Θ(min(n,m))` for the length, because each row depends only on the previous row.

**Proof.** There are `nm` cells, each computed in `O(1)`. For space: row `i` reads only row `i-1` and the current row, so two rows of length `min(n,m)+1` (orient `Y` as the shorter) suffice. ∎

The two-row reduction loses the table needed for the `O(n+m)` traceback; reconstructing the *subsequence* in `O(min(n,m))` space requires Hirschberg (Section 9).

### 3.1 Counting All LCS-Length Subproblems

**Proposition 3.3 (Number of distinct LCS).** The number of *distinct* longest common subsequences can be exponential in `n`. For `X = "aabb…"` patterns and `Y` chosen adversarially, the traceback DAG (the subgraph of table edges that participate in some optimal path) can have exponentially many source-to-sink paths. Counting them is done by a second DP over the same table: `ways[i][j]` accumulates path counts along the optimal edges, computed in `O(nm)`. This is why a function that returns *all* LCS cannot be output-polynomial in general, while returning *one* LCS (single traceback) is `O(n+m)`. The distinction mirrors the LIS count-of-optima problem (Section 6 / `senior.md` Fenwick formulation).

**Worked count.** `X = "ABCBDAB"`, `Y = "BDCAB"` has LCS length 4 but **three** distinct LCS: `"BCAB"`, `"BDAB"`, `"BCBA"`-style alignments depending on tie-breaks. A single traceback returns whichever the `≥` tie-break selects; enumerating all three requires exploring every maximal edge in the optimal DAG. The `ways` DP would report the count `3` (or the appropriate value for the exact strings) without materializing the subsequences.

**The `ways` recurrence.** Define `w[i][j]` = number of distinct LCS of `X_i, Y_j`. On a match (`x_i = y_j`), `w[i][j] = w[i-1][j-1]`. On a mismatch, combine whichever neighbors achieve the max: if `c[i-1][j] > c[i][j-1]` take `w[i-1][j]`; if `<` take `w[i][j-1]`; if `=` take their sum *minus* the overlap `w[i-1][j-1]` when `c[i-1][j-1]` also equals the max (inclusion–exclusion to avoid double-counting common prefixes). This subtraction is the subtle part and the most common bug in count-of-distinct-LCS implementations. The count can be exponential, so it is taken modulo a prime — the lengths are bounded, but the *number* of optima is not.

---

## 4. Reconstruction and the Edit-Distance Relation

**Theorem 4.1 (Traceback correctness).** Starting at `(n, m)` and moving diagonally on a match (emitting the character) or to the larger of `(i-1, j)` / `(i, j-1)` on a mismatch, until `i = 0` or `j = 0`, yields a sequence which, read in reverse, is an LCS of `X` and `Y`.

**Proof.** The traceback follows the dependency edges that *witness* each `c[i][j]` value. A diagonal step occurs exactly when `x_i = y_j` and `c[i][j] = c[i-1][j-1]+1`, so the emitted character is a genuine matched element appearing at positions `i` in `X` and `j` in `Y`, with strictly decreasing indices as we proceed — hence the emitted sequence is a subsequence of both. The number of diagonal steps equals `c[n][m]` because each match step decreases the recorded length by exactly 1 and mismatch steps preserve it (they move to a neighbor with equal value). Thus the emitted sequence has length `c[n][m] = lcs(X,Y)` and is common — an LCS. ∎

**Theorem 4.2 (LCS ↔ edit distance with indels only).** Let `d_{id}(X, Y)` be the minimum number of single-character **insertions and deletions** (no substitutions) to transform `X` into `Y`. Then

```
d_{id}(X, Y) = n + m − 2·lcs(X, Y).
```

**Proof.** Any indel-only transformation keeps a common subsequence fixed (the unchanged characters) and deletes the rest of `X` (`n − lcs` deletions) then inserts the rest of `Y` (`m − lcs` insertions). The cheapest such script keeps a *longest* common subsequence fixed, giving `(n − lcs) + (m − lcs) = n + m − 2·lcs`. Conversely, any indel script induces a common subsequence (the characters never touched), of length `≤ lcs`, so the cost is `≥ n + m − 2·lcs`. Equality holds at the LCS. ∎

**Corollary 4.3 (Diff duality).** Minimizing the edit script (Myers' diff) and maximizing the common subsequence are the same optimization: `d_{id} = n + m − 2·lcs`. This is why `git diff` is LCS reconstruction in disguise. The general Levenshtein distance (which also allows substitutions) is a *different* DP (sibling `04-edit-distance`); LCS corresponds to the *no-substitution* special case.

### 4.1 Worked Edit-Distance Identity

Let `X = "AGCAT"` (n=5), `Y = "GAC"` (m=3), with `lcs = 2`. Then the indel edit distance is `d_{id} = 5 + 3 − 2·2 = 4`: delete `'A'`(pos1), keep `'G'`, keep nothing, ... concretely keep the common `"AC"` and edit the rest. One minimal script: delete `X`'s first `'A'`, keep `'G'`? — careful: the kept subsequence must appear in both. Keeping `"AC"`: from `X="AGCAT"` delete `'G','A','T'` (3 deletions) leaving `"AC"`; into `"AC"` insert `'G'` before... to reach `Y="GAC"` insert `'G'` at front (1 insertion), giving `"GAC"`. Total `3 + 1 = 4 = d_{id}`. ✓ The identity `d_{id} = (n − lcs) + (m − lcs)` decomposes exactly as 3 deletions + 1 insertion.

### 4.2 Why Substitutions Change the DP

Allowing a substitution as a single operation makes mismatched aligned positions cost 1 instead of 2 (a delete-plus-insert). The Levenshtein recurrence therefore adds a third option on mismatch:

```
lev[i][j] = min( lev[i-1][j] + 1,        // delete x_i
                 lev[i][j-1] + 1,        // insert y_j
                 lev[i-1][j-1] + [x_i ≠ y_j] )  // match or substitute
```

LCS is recovered from the indel-only special case (drop the substitution branch, equivalently set the substitution cost to 2). This is why LCS and Levenshtein, though both `O(nm)` table DPs, are *not* the same problem — and why a system that needs "minimum keystrokes including replace" must use Levenshtein, not LCS. The relationship is exact: `lev_{id} = n + m − 2·lcs`, but `lev_{full} ≤ lev_{id}` because substitutions are cheaper.

### 4.3 The Edit Graph and Myers' Shortest-Path View

Model the alignment as a directed grid graph on vertices `(i, j)`, `0 ≤ i ≤ n`, `0 ≤ j ≤ m`, with edges:

- **Right** `(i, j) → (i, j+1)`: insert `y_{j+1}` (cost 1).
- **Down** `(i, j) → (i+1, j)`: delete `x_{i+1}` (cost 1).
- **Diagonal** `(i, j) → (i+1, j+1)` *only if* `x_{i+1} = y_{j+1}`: free match (cost 0).

A path from `(0,0)` to `(n,m)` is an alignment; its cost is the indel edit distance, and the number of diagonal (free) edges it uses is the length of the common subsequence it realizes. **Maximizing diagonals = LCS; minimizing total cost = edit distance** — the same path, two objectives, related by `cost = n + m − 2·(#diagonals)`. Myers' `O(nd)` algorithm runs a BFS on this graph along "diagonals `k = j − i`," advancing the furthest-reaching path per diagonal per edit count `d`, stopping when it reaches `(n,m)`. Because it explores only `O(nd)` of the `O(nm)` vertices, it is fast when `d` is small. This graph formalism unifies LCS, edit distance, and diff into a single shortest/longest-path picture and is the standard mental model in production diff implementations. ∎

---

## 5. The LIS Optimal-Substructure Theorem (Proof)

**Definition 5.1.** `L_i` = length of the longest strictly increasing subsequence of `A` that **ends at index `i`** (i.e. whose last element is `a_i`).

**Theorem 5.2 (LIS recurrence).**
```
L_i = 1 + max{ L_j : j < i and a_j < a_i }      (max over empty set = 0)
lis(A) = max_i L_i.
```

**Proof.** Consider a longest increasing subsequence `S` ending at `i`. If `|S| = 1`, then `S = (a_i)` and no earlier `a_j < a_i` extends it, matching `L_i = 1`. If `|S| ≥ 2`, let `j` be the index of the element preceding `a_i` in `S`. Then `j < i` and `a_j < a_i`, and `S` minus its last element is an increasing subsequence ending at `j` of length `L_i − 1`; it must be a *longest* one (else we could lengthen `S`), so `L_i − 1 = L_j`, giving `L_i = L_j + 1 ≤ 1 + max{L_j : j<i, a_j<a_i}`. Conversely, any `j` with `j<i, a_j<a_i` yields an increasing subsequence of length `L_j + 1` ending at `i`, so `L_i ≥ 1 + max{…}`. Equality follows. Finally an LIS ends *somewhere*, so `lis(A) = max_i L_i`. ∎

This DP is `Θ(n²)` (each `L_i` scans all `j < i`). The non-decreasing variant replaces `a_j < a_i` by `a_j ≤ a_i`.

### 5.1 Worked LIS DP

For `A = [10, 9, 2, 5, 3, 7, 101, 18]`:

```
index  0   1   2   3   4   5    6     7
value  10  9   2   5   3   7    101   18
L_i    1   1   1   2   2   3    4     4
```

`L_3 = 2` because the only smaller earlier element is `a_2 = 2`, giving `1 + L_2 = 2`. `L_5 = 3` from chain `2 → 3 → 7` (predecessor `a_4 = 3` with `L_4 = 2`). `L_6 = 4` from `2 → 3 → 7 → 101`. The answer `max_i L_i = 4`, witnessed by `[2,3,7,101]` (ending at index 6) or `[2,3,7,18]` (ending at index 7). Both have length 4 — a reminder that the LIS is not unique.

**Proposition 5.3 (LIS values are not monotone but lengths interleave).** The sequence `(L_i)` need not be monotone (here it dips back conceptually only because indices reset), but the *running maximum* `max_{j≤i} L_j` is non-decreasing, and the final running maximum is `lis(A)`. This is why a single left-to-right pass tracking the running max suffices to report the length, while the per-index `L_i` array is needed to *reconstruct* (follow the predecessor achieving `L_i − 1`).

### 5.2 LIS as a Special LCS (the reverse direction)

The reduction of Section 8 turns a permutation-LCS into an LIS. The reverse embedding also holds and is instructive: `lis(A)` equals `lcs(A', sorted(A'))` where `A'` is `A` with ties broken to make values distinct, and `sorted(A')` is its ascending sort. A common subsequence of `A'` and its sorted copy is, by definition, a subsequence of `A'` that is also in sorted (increasing) order — i.e. an increasing subsequence. Hence:

```
lis(A) = lcs(A, sort(A))      (strict, distinct values)
```

This is a clean equivalence but a *bad* algorithm (`O(n²)` LCS instead of `O(n log n)` patience) — it is useful only as a conceptual bridge proving the two problems are facets of one. The non-decreasing LIS corresponds to a stable sort with a tie-break that keeps original order, so equal values can align. The lesson: LCS ⊇ LIS as problems, but the *efficient* direction is LCS-of-permutations → LIS, never LIS → general LCS.

**Theorem 5.4 (Parameterized landscape).** The following summarizes tractability by structural parameter:

| Problem | Parameter | Complexity |
|---------|-----------|------------|
| LIS | none | `O(n log n)` |
| LCS, general | none | `O(nm)`, SETH-quadratic |
| LCS, length `≤ k` | output `k` | `O(nk)` (k-band) |
| LCS, matches `r` | sparsity `r` | `O((r+n) log n)` |
| LCS, edit distance `d` | similarity `d` | `O(nd)` |
| LCS, distinct symbols | alphabet structure | `O(n log n)` |
| Count of LIS / LCS | none | `O(n log n)` / `O(nm)` |

Every sub-`O(nm)` LCS row buys its speed with a structural assumption; the parameter is what the algorithm exploits. ∎

---

## 6. Correctness of the Patience / Binary-Search LIS

The `O(n log n)` method maintains an array `tails` processed left to right. The correctness rests on two invariants — that `tails` is sorted (so binary search is valid) and that `tails[k]` is exactly the minimum tail of any length-`(k+1)` increasing subsequence (so its length tracks the LIS length). We prove both, then show reconstruction is valid. The proofs are entirely elementary (no probabilistic or amortized argument), which is part of why the patience method is so robust in practice: every step provably maintains the invariant, so there is no "amortized blow-up" failure mode to worry about.

**Definition 6.1.** After processing a prefix of `A`, let `tails[k]` (`0-indexed`) be the **minimum possible last element** over all strictly increasing subsequences of length `k+1` within that prefix (undefined if none of that length exists).

> **Intuition for the invariant.** Among all length-`(k+1)` increasing subsequences, the one with the *smallest* tail is the most "extensible" — it leaves the most room for future elements to continue the run. Greedily keeping the smallest tail per length is what makes the local binary-search decision globally optimal, an exchange-argument flavor shared with greedy algorithms (`14-greedy-algorithms`). The patience method is therefore a greedy algorithm whose optimality is *proved* by the matroid-like exchange in Lemma 6.3, not merely asserted.

**Lemma 6.2 (`tails` is strictly increasing).** At all times, `tails[0] < tails[1] < … < tails[L-1]` where `L` is the current LIS length.

**Proof.** Suppose `tails[k] ≥ tails[k+1]` for some `k`. Take an increasing subsequence `S` of length `k+2` whose last element is `tails[k+1]`. Its element at position `k+1` (the `(k+1)`-th, i.e. second-to-last) is some value `v < tails[k+1] ≤ tails[k]`, and the prefix of `S` of length `k+1` ending at `v` is an increasing subsequence of length `k+1` with last element `v < tails[k]`. This contradicts `tails[k]` being the *minimum* last element of a length-`(k+1)` subsequence. Hence `tails` is strictly increasing. ∎

**Lemma 6.3 (Update rule).** When processing `a_i = x`, let `p` be the leftmost index with `tails[p] ≥ x` (`lower_bound`). If no such `p`, append `x` (extending `tails` by one). Otherwise set `tails[p] = x`. After the update, `tails` still satisfies Definition 6.1.

**Proof.** *Append case:* `x` exceeds all current tails, so `x` extends every length-`L` subsequence (in particular one with the minimal tail `tails[L-1] < x`) to length `L+1`, and `x` is the minimal possible new tail since it is the only length-`(L+1)` subsequence's tail so far. *Overwrite case:* `x ≤ tails[p]` and (since `p` is leftmost with `tails[p] ≥ x`) `tails[p-1] < x`. Then `x` can extend the length-`p` subsequence with tail `tails[p-1] < x` into a length-`(p+1)` subsequence ending at `x`, and `x ≤ tails[p]` means `x` is a new, *smaller-or-equal* minimal tail for length `p+1`; positions other than `p` are unaffected because `x` neither extends a longer run (it is not `> tails[p]`) nor improves a shorter one (`tails[p-1] < x` already smaller). So Definition 6.1 is preserved. ∎

**Theorem 6.4 (Correctness and complexity).** After processing all of `A`, `len(tails) = lis(A)`, computed in `O(n log n)` time and `O(n)` space.

**Proof.** By Lemmas 6.2–6.3 the invariant of Definition 6.1 holds throughout, and `len(tails)` is always the largest `k+1` for which a length-`(k+1)` increasing subsequence exists — exactly the running LIS length. Each of the `n` elements performs one binary search (`O(log n)`, valid because `tails` is sorted by Lemma 6.2) and one `O(1)` update. ∎

**Non-decreasing variant.** Replace `lower_bound` (`tails[p] ≥ x`) with `upper_bound` (`tails[p] > x`). Then equal values extend a run, and Lemma 6.2 weakens to non-strict monotonicity; the proofs go through with `<` → `≤`.

**Theorem 6.6 (Equivalence to longest chain in a poset).** Define the strict-dominance partial order on indices: `i ≺ j` iff `i < j` and `a_i < a_j`. A strictly increasing subsequence is exactly a chain in `(\{1,…,n\}, ≺)`, and `lis(A)` is the longest-chain length. The patience method computes this longest chain in `O(n log n)`; the general longest-chain problem in an arbitrary DAG is solved by topological-order DP in `O(V+E)`, which here would be `O(n²)` (the comparability DAG has up to `Θ(n²)` edges). The `O(n log n)` patience algorithm beats the generic DAG approach precisely because the dominance order is *2-dimensional* (index and value), letting a single sorted structure replace explicit edge enumeration. This is the order-theoretic reason LIS is easier than general longest-path-in-DAG. ∎

**Reconstruction validity.** Storing, at each step, the input index now occupying `tails[p]` (`tailsIdx[p]`) and the predecessor `parent[i] = tailsIdx[p-1]`, then walking `parent` from `tailsIdx[L-1]`, yields a genuine increasing subsequence of length `L`: each `parent` link points to an element placed earlier (smaller index) and at a strictly smaller `tails` position (hence strictly smaller value at placement time), so following links gives strictly increasing values in strictly increasing original positions. ∎

### 6.1 Worked Patience Trace with Position Bookkeeping

For `A = [10, 9, 2, 5, 3, 7, 101, 18]` (strict, `lower_bound`):

```
x=10  p=0 (append)  tails=[10]              tailsIdx=[0]           parent[0]=-1
x=9   p=0 (replace) tails=[9]               tailsIdx=[1]           parent[1]=-1
x=2   p=0 (replace) tails=[2]               tailsIdx=[2]           parent[2]=-1
x=5   p=1 (append)  tails=[2,5]             tailsIdx=[2,3]         parent[3]=2
x=3   p=1 (replace) tails=[2,3]             tailsIdx=[2,4]         parent[4]=2
x=7   p=2 (append)  tails=[2,3,7]           tailsIdx=[2,4,5]       parent[5]=4
x=101 p=3 (append)  tails=[2,3,7,101]       tailsIdx=[2,4,5,6]     parent[6]=5
x=18  p=3 (replace) tails=[2,3,7,18]        tailsIdx=[2,4,5,7]     parent[7]=5
```

`len(tails) = 4`. Walking `parent` from `tailsIdx[3] = 7`: `7 → 5 → 4 → 2 → −1`, giving values `18, 7, 3, 2`, reversed to `[2, 3, 7, 18]` — a valid LIS of length 4. Note the *final* `tails = [2,3,7,18]` happens here to coincide with the reconstructed sequence, but in general it does **not** (Lemma 6.3 may overwrite a tail with a value from an incompatible position); the parent walk is what guarantees a genuine subsequence. This is the single most important correctness subtlety of the fast LIS.

**Lemma 6.5 (`tailsIdx` strictly increases along a parent chain).** Following `parent` from `tailsIdx[L-1]` visits input indices in strictly decreasing order (each `parent[i] < i` because it was placed earlier). Reversing yields strictly increasing original indices, and the corresponding values strictly increase because position `p` of `tails` held a value `< tails[p]` at the moment `a[i]` was placed there (Lemma 6.3, overwrite case `tails[p-1] < a[i]`). Hence the reconstruction respects both the index order (it is a subsequence) and the value order (it is increasing). ∎

---

## 7. Patience Sorting, Dilworth's Theorem, and the RSK Connection

The patience method is named after the card game: deal cards into piles, each card onto the **leftmost pile whose top is `≥` it**, opening a new pile if none qualifies.

**Theorem 7.1 (Patience pile count = LIS length).** The number of piles formed by greedy patience sorting equals `lis(A)`.

**Proof.** The pile tops, read left to right, are exactly the `tails` array (the pile a card lands on is the `lower_bound` position). By Theorem 6.4 the number of piles `= len(tails) = lis(A)`. Conversely, any increasing subsequence places its elements on strictly increasing pile indices (each later element of the subsequence is larger, so lands on a pile at least one further right), so it uses at most one card per pile — giving the LIS length `≤` pile count; equality is achieved by following back-pointers. ∎

**Theorem 7.2 (Dilworth's theorem, applied).** In any finite partial order, the minimum number of **chains** covering the set equals the maximum **antichain** size. For the "domination" order on the sequence (`i ≺ j` iff `i < j` and `a_i < a_j`):

- A **chain** is an increasing subsequence; the longest chain is the LIS.
- An **antichain** is a set of pairwise-incomparable elements — here a *non-increasing* subsequence.

**Consequence.** The piles of patience sorting form a partition into **decreasing** subsequences (each pile is decreasing top-to-bottom in the order cards were added). By Dilworth's dual (Mirsky's theorem), the minimum number of decreasing subsequences covering `A` equals the longest increasing subsequence — which is the pile count. This gives an independent, order-theoretic proof of `lis(A) = ` pile count, and shows LIS and "minimum decreasing cover" are dual quantities.

**RSK correspondence (sketch).** The Robinson–Schensted–Knuth correspondence maps a permutation to a pair of standard Young tableaux; the **length of the first row** of the insertion tableau equals the LIS, and the **length of the first column** equals the longest decreasing subsequence. Patience sorting is exactly the first-row insertion of RSK restricted to one row. This connects LIS to the rich combinatorics of Young tableaux, the Erdős–Szekeres theorem (any sequence of `> (r-1)(s-1)` distinct numbers has an increasing subsequence of length `r` or a decreasing one of length `s`), and the Baik–Deift–Johansson result that a random permutation's LIS is `≈ 2√n`.

### 7.1 Worked Dilworth / Patience Decomposition

Take the permutation `A = [3, 1, 4, 1, 5, 9, 2, 6]` (treat duplicate `1`s as distinct for the strict order). Greedy patience sorting:

```
3 -> pile0:[3]
1 -> 1 ≤ 3, place on pile0: pile0:[3,1]
4 -> 4 > all tops (top of pile0 is 1), new pile1:[4]
1 -> 1 ≤ top(pile0)=1, place on pile0: pile0:[3,1,1]
5 -> 5 > tops(1,4), new pile2:[5]
9 -> new pile3:[9]
2 -> 2 ≤ top(pile1)=4, place on pile1: pile1:[4,2]
6 -> 6 ≤ top(pile3)=9, 6 > top(pile2)=5, place on pile3: pile3:[9,6]
```

Result: **4 piles** → LIS length 4 (e.g. `1, 4, 5, 9` or `1, 4, 5, 6`). Each pile read top-to-bottom is **decreasing**: pile0 `[3,1,1]` reversed `1,1,3`... read bottom-to-top is `3,1,1` (non-increasing). So the piles form a partition of `A` into 4 decreasing subsequences — and by Dilworth/Mirsky duality, **4 = the minimum number of decreasing subsequences covering `A` = the longest increasing subsequence**. This worked instance exhibits both directions of Theorem 7.2 simultaneously.

### 7.2 The Erdős–Szekeres Bound, Concretely

Erdős–Szekeres: any sequence of `n > (r-1)(s-1)` distinct reals contains an increasing subsequence of length `r` **or** a decreasing one of length `s`. Proof via pigeonhole on the pair `(L_i^{inc}, L_i^{dec})` = (longest increasing ending at `i`, longest decreasing ending at `i`): if no increasing run reaches `r` and no decreasing run reaches `s`, each pair lies in `{1,…,r-1} × {1,…,s-1}`, only `(r-1)(s-1)` possibilities, so two indices `i < j` share a pair — but then `a_i < a_j` forces `L_j^{inc} > L_i^{inc}` and `a_i > a_j` forces `L_j^{dec} > L_i^{dec}`, either way contradicting equal pairs. Setting `r = s = ⌈√n⌉ + 1` shows every sequence of `n` distinct reals has a monotone subsequence of length `> √n` — a clean lower bound dovetailing with the `≈ 2√n` average for random permutations. This is the combinatorial floor beneath the LIS quantity the algorithms compute.

---

## 8. The LCS ↔ LIS Reduction for Permutations (Proof)

**Setup.** Let `X` and `Y` each be sequences of *distinct* symbols (permutations of a common set, or more generally each symbol appears at most once per string). Define `posY : Σ → ℕ` by `posY(s) =` the index of `s` in `Y`. Form `B` by scanning `X` and emitting `posY(x)` for each `x` that occurs in `Y` (skip symbols not in `Y`).

**Theorem 8.1.** `lis(B) = lcs(X, Y)` (strict LIS).

**Proof.** A common subsequence of `X` and `Y` is a set of symbols `s_1, …, s_k` that appears in this order in `X` *and* in this order in `Y`. Because `B` lists, in `X`-order, the `Y`-positions of `X`'s symbols, the symbols in `X`-order correspond to the entries of `B` in index order. The chosen symbols appear in increasing `Y`-order iff their `posY` values increase, i.e. iff the corresponding entries of `B` form a strictly increasing subsequence (strict because symbols are distinct, so positions differ). Therefore:

- Every common subsequence of length `k` ↦ a strictly increasing subsequence of `B` of length `k` (take the `posY` values, which appear in `X`-order in `B` and increase by the `Y`-order condition).
- Every strictly increasing subsequence of `B` of length `k` ↦ a common subsequence of length `k` (the symbols are in `X`-order by `B`'s construction and in `Y`-order by increasingness).

This is a length-preserving bijection between common subsequences and increasing subsequences of `B`, so their maxima coincide: `lcs(X, Y) = lis(B)`. ∎

**Complexity.** Building `B` is `O(n)` with a hash map for `posY`; `lis(B)` is `O(n log n)`. Hence LCS of two distinct-symbol permutations is `O(n log n)`, beating the general `O(nm)`.

**Why repeats break it.** If a symbol repeats in `Y`, `posY` is multivalued and the bijection fails. The general fix (Hunt–Szymanski, `senior.md`) replaces the single `posY` value by the *list* of `Y`-positions in **decreasing** order and threads them through the same LIS machinery, yielding `O((r + n) log n)` where `r` is the number of matching pairs. The permutation case is `r = n`, distinct positions — the clean special case proven here.

### 8.1 Worked Reduction

`X = "CABDE"`, `Y = "ABCDE"`. Positions in `Y`: `A→0, B→1, C→2, D→3, E→4`. Relabel `X`:

```
X:  C  A  B  D  E
B: [2, 0, 1, 3, 4]
```

`lis([2,0,1,3,4])`: process `2` (tails=[2]), `0` (tails=[0]), `1` (tails=[0,1]), `3` (tails=[0,1,3]), `4` (tails=[0,1,3,4]) → length 4. So `lcs("CABDE","ABCDE") = 4`. The increasing run `[0,1,3,4]` corresponds to `Y`-positions of `A,B,D,E`, i.e. the common subsequence `"ABDE"`, which indeed appears in `X = "CABDE"` (skip the leading `C`) and in `Y = "ABCDE"` (skip the `C`). The bijection of Theorem 8.1 maps `"ABDE"` ↔ `[0,1,3,4]` exactly.

### 8.2 Why the Decreasing-Order Insertion (Hunt–Szymanski)

For repeated symbols, when `X[i]` matches several `Y`-positions `p_1 < p_2 < … < p_t`, those positions are fed into the LIS structure in **decreasing** order `p_t, …, p_1`. The reason is subtle but essential: a single occurrence of a symbol in `X` may match at most one position in `Y` within one common subsequence. Inserting in decreasing order ensures that within the processing of one `X[i]`, no two of its `Y`-positions can both join the *same* increasing run (a later-inserted smaller position cannot sit after an earlier-inserted larger one in an increasing subsequence). This preserves the "one `X` element used once" constraint while reusing the patience machinery, giving the `O((r+n) log n)` bound. For distinct symbols (`t = 1` always), the order is irrelevant and the reduction degenerates to Theorem 8.1.

---

## 9. Hirschberg's Algorithm: Correctness and Complexity

Hirschberg reconstructs an LCS in `O(nm)` time and `O(min(n,m))` space.

**Definition 9.1.** Let `f(j) = lcs(X_{1..⌊n/2⌋}, Y_{1..j})` (forward) and `g(j) = lcs(reverse(X_{⌊n/2⌋+1..n}), reverse(Y_{j+1..m}))` (backward). Both are single rows computable in `O(m)` space.

**Theorem 9.2 (Optimal split).** Let `i = ⌊n/2⌋`. Then
```
lcs(X, Y) = max_{0 ≤ j ≤ m} ( f(j) + g(j) ),
```
and any maximizing `j*` is a column where an optimal LCS splits `Y` consistently with splitting `X` at row `i`.

**Proof.** Any common subsequence `Z` of `X, Y` partitions according to whether its elements come from `X`'s first half (`X_{1..i}`) or second half (`X_{i+1..n}`). Let those elements use `Y`-positions `≤ j` and `> j` respectively for the split point `j` separating them in `Y` (such a `j` exists because the elements are in increasing `Y`-order). The first part is a common subsequence of `X_{1..i}, Y_{1..j}` (length `≤ f(j)`) and the second of `X_{i+1..n}, Y_{j+1..m}` (length `≤ g(j)`), so `|Z| ≤ f(j) + g(j) ≤ max_j (f+g)`. Conversely, concatenating optimal halves at the maximizing `j*` produces a common subsequence of length `f(j*) + g(j*)`. Equality follows. ∎

**Theorem 9.3 (Complexity).** Hirschberg runs in `O(nm)` time and `O(m)` (i.e. `O(min(n,m))` after orienting) space.

**Proof.** Space: each level keeps two length-`m` rows plus `O(log n)` recursion frames. Time: the top level computes `f` and `g` in `O((n/2)·m) + O((n/2)·m) = O(nm)`. The recursion solves two subproblems of total size `i·j* + (n-i)·(m-j*) ≤ (n/2)·m`, so the work satisfies `T(n, m) = O(nm) + T(i, j*) + T(n-i, m-j*)` with the subproblem area at most half; summing the geometric series gives `T = O(nm)`. ∎

So Hirschberg pays a small constant factor in time (recomputing rows) to drop space from `Θ(nm)` to `Θ(min(n,m))` — the essential trade for memory-bound alignment and diff.

### 9.1 Worked Midline Split

`X = "AGCAT"` (n=5, split at `i = 2`, so `X[0..2) = "AG"`, `X[2..5) = "CAT"`), `Y = "GAC"` (m=3). Forward LCS-length row of `"AG"` vs prefixes of `"GAC"`:

```
f(j) for j=0..3:  f = [0, 1, 1, 1]   (lcs("AG","") , lcs("AG","G"), lcs("AG","GA"), lcs("AG","GAC"))
```

Backward LCS-length row of reverse(`"CAT"`) = `"TAC"` vs reverse(prefixes of `"GAC"`):

```
g(j) for j=0..3 (g(j)=lcs("TAC", reverse(Y[j..3]))):  g = [1, 1, 1, 0]
```

Maximize `f(j) + g(j)`:

```
j=0: 0+1=1   j=1: 1+1=2   j=2: 1+1=2   j=3: 1+0=1
```

The maximum is `2`, attained at `j* = 1` (or `2`). Take `j* = 1`: recurse on `("AG", "G")` and `("CAT", "AC")`. The first yields `"G"`... but the overall LCS is length 2; with `j*=2` the split gives `("AG","GA")` → `"A"` and `("CAT","C")` → `"C"`, concatenating to `"AC"`, the LCS. The choice among maximizing `j*` values yields different (equally optimal) LCS strings — consistent with non-uniqueness (Prop. 5.3 analog for LCS).

### 9.2 The Recurrence-Tree Cost Accounting

Hirschberg's time recurrence is `T(n, m) = c·n·m + T(n/2, j*) + T(n/2, m − j*)`. The two subproblems have column counts summing to `m`, and each has `n/2` rows, so their combined area is `(n/2)·j* + (n/2)·(m−j*) = (n/2)·m`, exactly half the current level's `n·m`. Summing the geometric series `nm + nm/2 + nm/4 + … = 2nm = O(nm)`. The recursion depth is `O(log n)` (halving rows), giving the `O(log n)` stack term added to the `O(m)` row storage — total space `O(m + log n) = O(min(n,m))` after orienting `Y` as the shorter string. This area-halving argument is the crux; without it one might fear `O(nm log n)`.

### 9.3 Hirschberg vs Myers: Two Linear-Space Reconstructions

Both Hirschberg and Myers reconstruct an alignment in linear space, but they optimize different parameters:

| Algorithm | Time | Space | Wins when |
|-----------|------|-------|-----------|
| Hirschberg | `O(nm)` | `O(min(n,m))` | inputs dissimilar (`d` large), need exact LCS |
| Myers (linear-space variant) | `O(nd)` | `O(n)` | inputs similar (`d` small), diff use case |

Myers' `d`-band is narrower when the files differ little; Hirschberg's `nm` is insensitive to similarity. A production diff library typically uses Myers (Git's default) because real edits are small (`d ≪ n`), falling back to Hirschberg-style banding only for pathological inputs. The theoretical point: linear *space* is achievable two ways — divide-and-conquer recomputation (Hirschberg) or bounded-band exploration (Myers) — and the choice is a function of expected `d`. Both are provably correct by the optimal-substructure of Theorem 2.1; they differ only in *which* subset of the table they materialize.

---

## 10. Longest Common Substring: A Different Recurrence

**Definition 10.1.** A **common substring** of `X, Y` is a string that is a (contiguous) substring of both. `lcsub(X, Y)` is the maximum length.

**Theorem 10.2 (Substring recurrence).** Let `s[i][j]` = length of the longest common *suffix* of `X_i` and `Y_j`. Then
```
s[i][j] = s[i-1][j-1] + 1   if x_i = y_j
s[i][j] = 0                 if x_i ≠ y_j
lcsub(X, Y) = max_{i,j} s[i][j].
```

**Proof.** A common suffix of `X_i, Y_j` of positive length must end in `x_i = y_j`, with the preceding characters forming a common suffix of `X_{i-1}, Y_{j-1}`; hence the `+1` recurrence on a match. On a mismatch no common suffix ends at `(i, j)`, so `s[i][j] = 0` (contiguity is *broken*). A common substring is a common suffix of *some* prefix pair, so the global maximum over all `(i, j)` is `lcsub`. ∎

**Contrast with LCS (Corollary 2.2).** The *only* differences are (a) mismatch resets to `0` (substring) instead of carrying `max(up, left)` (subsequence), and (b) the answer is the global max cell (substring) instead of the corner (subsequence). This single algebraic difference — reset vs carry — is the formal boundary between the two problems, and it is also why longest common substring admits an `O(n+m)` suffix-automaton/suffix-tree solution (the contiguity makes it a string-matching problem) while general LCS does not.

### 10.1 Worked Substring vs Subsequence

`X = "ABCBDAB"`, `Y = "BDCAB"`. The substring suffix table `s[i][j]` (only the nonzero cells matter):

- Matches occur where characters coincide; each match cell is `1 + ` its diagonal predecessor, and any mismatch is `0`.
- The longest diagonal run of matches gives `s[i][j] = 2` (e.g. the contiguous `"AB"` shared at the ends, or `"CB"`-type alignments depending on indices). So `lcsub = 2`.
- The LCS (subsequence) of the same pair is `"BCAB"`, length `4`.

The gap (`2` vs `4`) is dramatic and concrete: the contiguous requirement throws away the gapped matches `B…C…A…B` that the subsequence DP stitches together. No post-processing converts one into the other — they are genuinely different optimizations, exactly as Theorem 10.2's reset-vs-carry distinction predicts.

**Theorem 10.3 (Substring via suffix structures).** The longest common substring of `X, Y` can be found in `O(n + m)` time by building a generalized suffix automaton (or suffix tree) of both strings and finding the deepest node reachable by both — strictly better than the `O(nm)` DP. This is impossible for subsequence LCS (conditionally, Section 11), and the reason is structural: a substring is a path in a suffix structure, whereas a subsequence is not. ∎ (Construction details in `string-algorithms`.)

---

## 11. Lower Bounds and Hardness

**Theorem 11.1 (LCS conditional lower bound).** Computing `lcs(X, Y)` for binary strings in `O((nm)^{1-ε})` time for any `ε > 0` would refute the **Strong Exponential Time Hypothesis (SETH)** (Abboud–Backurs–Williams 2015; Bringmann–Künnemann 2015). Hence the quadratic `O(nm)` DP is essentially optimal in the worst case for general strings.

**Proof idea.** A subquadratic LCS algorithm yields a subquadratic algorithm for orthogonal vectors / satisfiability via a fine-grained reduction, contradicting SETH. The reduction encodes a CNF formula's clause-variable structure into two strings whose LCS reveals satisfiability. ∎

**Consequence.** Unlike LIS (which is `O(n log n)`, genuinely subquadratic), LCS has no known truly subquadratic algorithm and conditionally cannot have one. The practical speedups (Hunt–Szymanski `O((r+n) log n)`, Myers `O(nd)`, the permutation reduction `O(n log n)`) all exploit *structure* (sparse matches, small edit distance, distinct symbols); none beats `O(nm)` on adversarial dense inputs.

**Theorem 11.2 (LIS optimality in the comparison model).** Any comparison-based algorithm computing `lis(A)` requires `Ω(n log n)` comparisons in the worst case.

**Proof idea.** LIS length is at least as hard as detecting whether all elements are distinct / sortedness-type problems; an `Ω(n log n)` element-distinctness-style bound transfers. The patience method matches this, so `O(n log n)` is optimal in the comparison model. (With integer keys in a bounded range, van Emde Boas / radix structures can beat `log n` factors, paralleling integer-sorting speedups.) ∎

### 11.3 Numerical and Implementation Notes for Exactness

LCS and LIS are *integer* problems — no floating point, no rounding — so "exactness" concerns the auxiliary quantities, not the lengths:

- **Count-of-LIS / count-of-LCS** can overflow 64-bit integers (the number of optima grows combinatorially). Reduce modulo a prime, or use big integers, and document which. The lengths themselves are bounded by `min(n, m)` and never overflow.
- **Sentinel choices** in LIS reconstruction (`parent = -1`) must not collide with valid indices; use a sentinel outside `[0, n)`.
- **Tie-breaking determinism.** The `≥` vs `>` choice in the LCS traceback (and the lower/upper bound in LIS) fixes *which* optimum is returned. For reproducible cross-language behavior (Go/Java/Python), pin the same tie-break everywhere; otherwise the *length* matches but the *witness* differs, which trips naive equality tests.
- **Coordinate compression for BIT-based LIS variants** must preserve the strict/non-decreasing semantics: compress to dense ranks, and for strict LIS query the prefix `[1, rank(x) − 1]`, for non-decreasing query `[1, rank(x)]`. An off-by-one in the rank range silently flips the variant.

These are the practical correctness hazards that survive the clean integer math; they are where production LCS/LIS bugs actually live, complementing the asymptotic theory above.

**The asymmetry.** LCS (two sequences, dense) is conditionally quadratic; LIS (one sequence) is `Θ(n log n)`. The permutation reduction (Section 8) shows that the *special case* of LCS reducible to LIS inherits the easier bound — the structure (distinctness) is exactly what collapses the quadratic barrier.

### 11.1 The Reduction Sketch Behind the SETH Barrier

The fine-grained reduction (Abboud–Backurs–Williams) encodes an **Orthogonal Vectors (OV)** instance — two families of `N` Boolean vectors in `{0,1}^d`, asking whether some pair is orthogonal — into two strings whose LCS reveals the answer. Each vector becomes a gadget string; coordinate-wise orthogonality is engineered to manifest as a specific LCS length threshold. Since OV has no `O(N^{2−ε})` algorithm under SETH, and the gadget strings have length `O(N · poly(d))`, an `O((nm)^{1−ε})` LCS would give a subquadratic OV algorithm, refuting SETH. The takeaway for a practitioner: **do not search for a clever general subquadratic LCS** — it would be a complexity-theoretic breakthrough. Optimize constants (cache, SIMD) or exploit structure (sparsity via Hunt–Szymanski, similarity via Myers, distinctness via the LIS reduction) instead.

### 11.2 The Bounded-Alphabet and Bounded-Length Escapes

The SETH barrier is for *general* (binary suffices) strings with *unbounded* LCS. Special structure escapes it:

| Structure | Best known LCS time |
|-----------|---------------------|
| General strings (dense) | `O(nm / log² n)` (Masek–Paterson, four-Russians) — quadratic up to log factors |
| `r` matching pairs (sparse) | `O((r + n) log n)` (Hunt–Szymanski) |
| Edit distance `d` (similar) | `O(nd)` (Myers) |
| Distinct symbols (permutations) | `O(n log n)` (LIS reduction) |
| LCS length `≤ k` | `O(nk)` (k-band) |

The **Masek–Paterson** four-Russians method shaves a `log² n` factor off the `O(nm)` DP by precomputing all possible behaviors of small table blocks over a bounded alphabet — the only general improvement, and only polylogarithmic. None of these contradicts the SETH lower bound, which is about the *worst case over all inputs*; they win by assuming the input has exploitable structure. Recognizing which structure your data has is the entire practical art of fast LCS.

---

## 12. Summary

- **LCS optimal substructure** (Theorem 2.1): match ⇒ extend the diagonal subproblem; mismatch ⇒ drop one last character. Yields the `Θ(nm)` recurrence, correct by induction on `i+j`, with `Θ(min(n,m))` space for length only.
- **Reconstruction** follows the witness edges; the emitted path is an LCS (Theorem 4.1). LCS is dual to indel-only edit distance: `d_{id} = n + m − 2·lcs` (Theorem 4.2) — the reason diff is LCS.
- **LIS optimal substructure** (Theorem 5.2): `L_i = 1 + max{L_j : j<i, a_j<a_i}`, the `O(n²)` DP.
- **Patience LIS** is correct because `tails` stays strictly increasing (Lemma 6.2) and each update preserves the "minimum tail per length" invariant (Lemma 6.3); `len(tails) = lis(A)` in `O(n log n)` (Theorem 6.4).
- **Order theory:** patience pile count = LIS (Theorem 7.1); Dilworth/Mirsky duality links LIS to minimum decreasing covers; RSK ties LIS to Young-tableaux row lengths and the `≈ 2√n` average LIS.
- **Permutation reduction** (Theorem 8.1): relabel `X` by `Y`-positions; `lis(B) = lcs(X, Y)`, giving `O(n log n)` for distinct-symbol LCS. Hunt–Szymanski generalizes to `O((r+n) log n)`.
- **Hirschberg** (Theorems 9.2–9.3): midline split `lcs = max_j (f(j) + g(j))`, reconstructed by divide-and-conquer in `O(nm)` time and `O(min(n,m))` space.
- **Longest common substring** is a *different* recurrence (Theorem 10.2): reset-on-mismatch, answer = max cell — the formal subsequence/substring boundary.
- **Hardness asymmetry** (Section 11): LCS is conditionally quadratic under SETH; LIS is `Θ(n log n)`-optimal. Structure (sparsity, small `d`, distinctness) is what enables every LCS speedup.

### Complexity Cheat Table

| Task | Method | Complexity | Tight? |
|------|--------|------------|--------|
| LCS length | DP | `O(nm)` time, `O(min)` space | quadratic-optimal under SETH |
| LCS reconstruction, linear space | Hirschberg | `O(nm)` time, `O(min)` space | — |
| LCS, sparse matches | Hunt–Szymanski | `O((r+n) log n)` | — |
| LCS, small edit distance | Myers | `O(nd)` | — |
| LCS of two permutations | reduce to LIS | `O(n log n)` | — |
| LIS length / subsequence | patience + binary search | `O(n log n)` | `Ω(n log n)` comparison-optimal |
| LIS (DP) | per-index DP | `O(n²)` | — |
| Longest common substring | suffix-recurrence DP | `O(nm)` (or `O(n+m)` suffix automaton) | — |

### Closing Notes

- **Edit-distance duality** (Section 4): `d_{id} = n + m − 2·lcs` makes "diff is LCS" a theorem, not an analogy.
- **Dilworth/RSK** (Section 7): LIS is a chain-cover quantity; its `2√n` average and the Erdős–Szekeres bound are the combinatorial backdrop.
- **Permutation reduction** (Section 8): the bijection between common subsequences and increasing subsequences is the bridge that powers patience diff and Hunt–Szymanski.
- **SETH barrier** (Section 11): LCS's quadratic cost is not a failure of cleverness but a conditional lower bound; speedups require structural assumptions.
- **Edit graph** (Section 4.3): LCS, edit distance, and diff are one shortest/longest-path problem on the alignment grid — maximize diagonals or minimize cost, related by `cost = n + m − 2·lcs`.
- **Poset framing** (Sections 6–7): LIS is the longest chain in the 2D dominance order; the `O(n log n)` patience method beats generic longest-path-in-DAG precisely because that order is two-dimensional.
- **Monotonicity** (Prop 2.3): the LCS table is Lipschitz (neighbors differ by ≤ 1), which is what makes both the traceback well-defined and the Hunt–Szymanski contour formulation possible.

Foundational references: CLRS Ch. 15 (LCS DP); Hirschberg (1975); Hunt–Szymanski (1977); Myers (1986); Masek–Paterson (1980) for the four-Russians LCS speedup; Schensted (1961) and Knuth for RSK; Dilworth (1950) and Mirsky (1971) for the chain/antichain duality; Erdős–Szekeres (1935); Baik–Deift–Johansson (1999) for the `2√n` LIS limit law; Fredman (1975) for the LIS comparison lower bound; Abboud–Backurs–Williams (2015) and Bringmann–Künnemann (2015) for the SETH lower bound. Sibling topics: `04-edit-distance`, `01-introduction-to-dp`, and `string-algorithms`.

### One-Paragraph Synthesis

LCS and LIS are two windows onto the same DP machinery. LCS is a two-sequence alignment whose optimal substructure (match → diagonal, mismatch → max) yields a quadratic table, conditionally optimal under SETH, reconstructible by traceback or — in linear space — by Hirschberg's midline divide-and-conquer. LIS is a single-sequence longest-chain problem in the 2D dominance poset, solvable in comparison-optimal `O(n log n)` by the greedy patience method whose correctness is the "smallest tail per length" invariant, with Dilworth/RSK supplying the order-theoretic and combinatorial backdrop. The bridge between them — the permutation reduction and its Hunt–Szymanski generalization — is not a curiosity but the engine of fast, real-world diff. Every practical speedup over the dense `O(nm)` LCS buys its asymptotics with a structural assumption (sparsity, similarity, or distinctness); recognizing which assumption your data satisfies is the whole art.
