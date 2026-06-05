# Word Break (String Segmentation DP) — Mathematical Foundations and Complexity Theory

## Table of Contents
1. Formal Definitions
2. The Boolean Recurrence: Optimal Substructure and Correctness
3. Complexity of the Decision Problem
4. Counting Segmentations and Generating Functions
5. Why Word Break II Is Exponential: Worst-Case Sentence Counts
6. The Segmentation Semiring: One DP, Many Outputs
7. Top-Down vs Bottom-Up: Equivalence and Cost
8. The DFA / Regular-Language Connection
9. The Segmentation Lattice as a DAG
10. Lower Bounds and Relationships
11. Summary

---

## 1. Formal Definitions

Let `Σ` be a finite alphabet, `s = s₀ s₁ … s_{n-1} ∈ Σⁿ` a string of length `n`, and `D ⊆ Σ⁺` a finite **dictionary** of nonempty words. Write `s[j..i)` for the substring `s_j s_{j+1} … s_{i-1}` (half-open, indices `0 ≤ j ≤ i ≤ n`); `s[i..i)` is the empty string `ε`.

**Definition 1.1 (Segmentation).** A **segmentation** of `s` is a sequence of cut points `0 = c₀ < c₁ < … < c_m = n` such that every chunk `s[c_{t-1}..c_t) ∈ D` for `1 ≤ t ≤ m`. The sequence of chunks `(w₁, …, w_m)` with `w_t = s[c_{t-1}..c_t)` is an ordered factorization of `s` into dictionary words. The number `m` is the **number of words** in the segmentation.

**Definition 1.2 (Word Break decision problem, WB-I).** `WORD-BREAK(s, D)`: decide whether at least one segmentation of `s` exists.

**Definition 1.3 (Word Break enumeration problem, WB-II).** `WORD-BREAK-ALL(s, D)`: output every segmentation of `s` (as the list of chunk sequences).

**Definition 1.4 (Counting problem, #WB).** `#WORD-BREAK(s, D)`: output the number of distinct segmentations of `s`.

**Definition 1.5 (Segmentability predicate).** Let `seg(i) :⟺ s[0..i)` has at least one segmentation, for `0 ≤ i ≤ n`. By convention `seg(0) = ⊤` (the empty prefix is segmented by the empty sequence, `m = 0`). The answer to WB-I is `seg(n)`.

**Remark.** The empty-prefix convention `seg(0) = ⊤` is forced, exactly as `A⁰ = I` is forced in matrix problems: the empty product (zero words) factorizes the empty string. Any other choice breaks the base case of Theorem 2.1 and the DP simultaneously.

**Notation conventions.** Throughout:

| Symbol | Meaning |
|--------|---------|
| `n` | `|s|`, the length of the input string |
| `L` | `max_{w ∈ D} |w|`, the longest dictionary word length |
| `‖D‖` | `Σ_{w∈D} |w|`, total dictionary size in characters |
| `s[j..i)` | half-open substring, indices `j` (incl.) to `i` (excl.) |
| `seg(i)` | "is `s[0..i)` segmentable?" (prefix predicate) |
| `seg'(i)` | "is `s[i..n)` segmentable?" (suffix predicate) |
| `N(i)` | number of segmentations of `s[0..i)` |
| `D*` | Kleene star of `D` (all finite concatenations) |
| `G_s` | the segmentation DAG (vertices `0..n`, edges = matches) |
| `[P]` | Iverson bracket: `1` if `P` holds, else `0` |
| `φ`, `ρ` | golden ratio `(1+√5)/2`; smallest positive root of `1 − Σ x^ℓ` |

The Iverson bracket `[s[j..i) ∈ D]` is `1` exactly when the chunk is a dictionary word, and `0` otherwise; it is the `edge(j,i)` indicator that becomes `1̄`/`0̄` in the semiring view of Section 6. All results hold for any finite `D ⊆ Σ⁺`; the alphabet `Σ` may be characters, bytes, or Unicode code points as long as `s` and `D` agree on the unit.

---

## 2. The Boolean Recurrence: Optimal Substructure and Correctness

**Theorem 2.1 (Word Break recurrence).** For all `0 ≤ i ≤ n`,

```
seg(i)  ⟺  (i = 0)  ∨  ∃ j ∈ [0, i) : ( seg(j) ∧ s[j..i) ∈ D ).
```

**Proof.**

*(⇐)* If `i = 0`, `seg(0) = ⊤` by convention. Otherwise suppose there is `j` with `seg(j)` and `s[j..i) ∈ D`. By `seg(j)` there is a segmentation `(w₁, …, w_{m})` of `s[0..j)`. Appending the word `s[j..i) ∈ D` yields the chunk sequence `(w₁, …, w_m, s[j..i))`, whose concatenation is `s[0..i)` and all of whose chunks lie in `D`. Hence `seg(i)`.

*(⇒)* Suppose `seg(i)` with `i > 0`. Take any segmentation of `s[0..i)`; it is nonempty (its concatenation is the nonempty `s[0..i)`), so it has a **last** word `w_m = s[c_{m-1}..i)`. Set `j := c_{m-1}`. Then `s[j..i) = w_m ∈ D`, and the prefix `(w₁, …, w_{m-1})` is a segmentation of `s[0..j)`, so `seg(j)`. Thus the disjunction holds with this `j`. ∎

**Optimal substructure (Definition).** A problem has *optimal substructure* when an optimal/valid solution is composed of optimal/valid solutions to subproblems. Theorem 2.1 establishes it for WB: a segmentation of `s[0..i)` is a segmentation of a strictly shorter prefix `s[0..j)` plus one final dictionary word. The subproblem `seg(j)` is independent of *which* words segment `s[0..j)` — only its truth matters.

**Overlapping subproblems.** Distinct prefixes share suffix subproblems: deciding `seg(i)` consults `seg(j)` for many `j`, and each `seg(j)` is consulted by many larger `i`. There are only `n+1` distinct subproblems `seg(0), …, seg(n)`, so memoization/tabulation collapses the exponential naive recursion to polynomial — the two hallmarks (optimal substructure + overlapping subproblems) that make DP applicable.

**Theorem 2.2 (DP correctness).** Filling `dp[0] := ⊤`, then `dp[i] := ⋁_{j<i} (dp[j] ∧ [s[j..i) ∈ D])` for `i = 1, …, n`, computes `dp[i] = seg(i)` for all `i`, and in particular `dp[n] = seg(n)`.

**Proof (induction on `i`).** Base: `dp[0] = ⊤ = seg(0)`. Step: assume `dp[j] = seg(j)` for all `j < i`. The bottom-up order computes `dp[i]` after all `dp[j]` with `j < i` are final, so the recurrence of Theorem 2.1 evaluates with correct operands, giving `dp[i] = seg(i)`. ∎

**Corollary 2.3 (Length cap).** Since `s[j..i) ∈ D ⟹ |s[j..i)| = i - j ≤ L`, the disjunction need only range over `j ∈ [max(0, i-L), i)`. This preserves correctness (it drops only `j` for which the membership test is necessarily false) and bounds the inner loop by `L`.

### 2.1 Worked Verification of the Recurrence

Take `s = "leetcode"` (so `n = 8`) and `D = {"leet", "code"}` with `L = 4`. The table tracks `seg(i)` and, when it becomes true, the witnessing split point `j`:

```
i = 0 : seg(0) = ⊤                              (base case, empty prefix)
i = 1 : "l"        none                          seg(1) = ⊥
i = 2 : "le"       none                          seg(2) = ⊥
i = 3 : "lee"      none                          seg(3) = ⊥
i = 4 : "leet"     j=0: seg(0) ∧ "leet"∈D = ⊤    seg(4) = ⊤  (witness j=0)
i = 5 : "leetc"…   none in [1,5)                 seg(5) = ⊥
i = 6 : "leetco"…  none                          seg(6) = ⊥
i = 7 : "leetcod"… none                          seg(7) = ⊥
i = 8 : "code"     j=4: seg(4) ∧ "code"∈D = ⊤    seg(8) = ⊤  (witness j=4)
```

The chain of witnesses `8 → 4 → 0` recovers the segmentation `"leet" · "code"`, illustrating both Theorem 2.1 (the recurrence) and the parent-pointer reconstruction. Every read of `seg(j)` at row `i` consults a strictly smaller index already finalized — the formal content of Theorem 2.2's induction.

### 2.2 The Last-Word Bijection, Made Explicit

The inductive step of Theorem 2.1 rests on a **bijection**

```
{ segmentations of s[0..i) }  ≅  ⊎_{j : s[j..i)∈D}  { segmentations of s[0..j) },
```

a disjoint union indexed by the last cut point `j = c_{m-1}`. Disjointness holds because `j` is *determined* by a segmentation (it is the start of its last word), so no segmentation is counted under two different `j`. Surjectivity holds because appending the word `s[j..i)` to any segmentation of `s[0..j)` yields a segmentation of `s[0..i)`. Taking cardinalities turns the disjoint union into the *sum* of Theorem 4.2; collapsing cardinalities to "nonempty?" turns it into the *OR* of Theorem 2.1. The two recurrences are the same bijection read through two different semirings (Section 6).

---

## 3. Complexity of the Decision Problem

**Theorem 3.1 (WB-I time complexity).** WB-I is solvable in `O(n · L · C)` time and `O(n)` space (besides the dictionary), where `C` is the cost of one membership/substring test.

**Proof.** There are `n` end positions `i`; for each, the capped inner loop (Corollary 2.3) runs `≤ L` iterations; each iteration performs one membership test costing `C`. The `dp` array is `O(n)`. ∎

**Cost of the membership test `C`.**

| Dictionary structure | `C` (per check) | WB-I total |
|----------------------|-----------------|------------|
| Hash set, substring built each time | `O(L)` build + hash | `O(n · L²)` worst / `O(n·L)` amortized with rolling hash |
| Hash set, precomputed rolling hashes | `O(1)` expected | `O(n · L)` expected |
| Trie walk from each start | amortized `O(1)` per char, `O(L)` per start total | **`O(n · L)`** with no per-check substring |

The Trie reorganizes the computation: instead of `n·L` independent substring tests, it does `n` walks of length `≤ L`, each step a single child lookup, **without constructing any substring**. This is why the Trie is the canonical optimization — it removes both the substring-allocation constant and the worst-case `O(L)` hashing.

**Theorem 3.2 (Lower bound).** WB-I requires `Ω(n)` time (every character may affect the answer) and `Ω(‖D‖)` to read the dictionary once. The `O(n·L)` upper bound is therefore within an `O(L)` factor of the trivial `Ω(n)` lower bound; for constant `L` it is linear-optimal.

### 3.1 The Trie Realization, Formally

The Trie reorganizes the `n` independent "for each `i`, scan back over `j`" loops into `n` forward walks. The reference algorithm:

```
WORD-BREAK-TRIE(s, root):
  dp[0] := ⊤; dp[1..n] := ⊥
  for i := 0 to n-1:
    if not dp[i]: continue
    node := root
    for j := i to n-1:
      node := child(node, s[j])
      if node = nil: break          # no dictionary word continues s[i..j]
      if end-of-word(node): dp[j+1] := ⊤
  return dp[n]
```

**Proposition 3.3 (Trie correctness).** The Trie algorithm sets `dp[j+1] := ⊤` exactly when `dp[i] = ⊤` and `s[i..j+1) ∈ D` for some `i ≤ j`, which is the recurrence of Theorem 2.1 (reorganized by the *start* `i` of the last word rather than its end). Hence it computes `seg(i)` for all `i`.

**Proof.** The inner walk from a segmentable position `i` follows the unique Trie path spelling `s[i], s[i+1], …`; it reaches an end-of-word node at depth `d` iff `s[i..i+d) ∈ D`. Setting `dp[i+d] := ⊤` is exactly applying Theorem 2.1's disjunct with `j = i` (last word `s[i..i+d)`). Every `(i, d)` pair with `dp[i]` and `s[i..i+d) ∈ D` is visited, so every disjunct that should fire does. The break on `node = nil` is sound: if no dictionary word has prefix `s[i..j+1)`, none extends it either. ∎

**Cost accounting.** Each outer index `i` walks at most `L` steps (the Trie has depth `≤ L`), each step a single child lookup (`O(1)` with an array-indexed Trie, `O(1)` expected with a hash-map Trie). No substring is ever materialized. Total: `O(n·L)` time, `O(‖D‖)` space for the Trie. This matches the hash-set asymptotics but removes the `O(n²)` substring allocations — the practically dominant cost.

---

## 4. Counting Segmentations and Generating Functions

**Definition 4.1 (Count function).** Let `N(i)` = the number of distinct segmentations of `s[0..i)`, with `N(0) = 1` (the empty segmentation).

**Theorem 4.2 (Counting recurrence).**

```
N(i) = Σ_{j ∈ [0, i)} [ s[j..i) ∈ D ] · N(j),     N(0) = 1.
```

Reference implementation (modular, to avoid overflow of the exponentially large count):

```
COUNT-SEG(s, D, p):
  N[0] := 1; N[1..n] := 0
  for i := 1 to n:
    for j := max(0, i-L) to i-1:
      if s[j..i) ∈ D:
        N[i] := (N[i] + N[j]) mod p
  return N[n]
```

**Proof.** The bijection from the proof of Theorem 2.1 is now refined to count: every segmentation of `s[0..i)` (for `i>0`) decomposes **uniquely** by its last word `s[j..i) ∈ D` into (a segmentation of `s[0..j)`) ⊕ (that last word). Distinct `j`, or distinct prefix segmentations, give distinct full segmentations, and every full segmentation arises exactly once. By the multiplication/addition principle, `N(i) = Σ_j [s[j..i)∈D] N(j)`. ∎

This is the **same recurrence as WB-I with `∨ ↦ +` and `⊤ ↦ 1`** — the boolean OR semiring replaced by the counting `(+, ×)` semiring (Section 6). It runs in the same `O(n·L)` time. The count, however, can be astronomically large (Section 5), so it is computed mod a prime `p` (using the homomorphism `φ_p` that commutes with `+` and `·`) or with big integers.

**Theorem 4.3 (Generating-function form for uniform dictionaries).** For the special "all-equal-character" instance `s = aⁿ` with `D ⊆ {a, aa, aaa, …}`, let `S = { ℓ : a^ℓ ∈ D }` be the set of allowed run lengths. Then `N(n)` satisfies the linear recurrence

```
N(n) = Σ_{ℓ ∈ S} N(n - ℓ)    (N(0)=1, N(m)=0 for m<0),
```

with ordinary generating function

```
F(x) = Σ_{n≥0} N(n) xⁿ = 1 / ( 1 − Σ_{ℓ ∈ S} x^ℓ ).
```

**Proof.** Specialize Theorem 4.2: when `s = aⁿ`, `s[j..i) = a^{i-j} ∈ D ⟺ (i-j) ∈ S`, so `N(i) = Σ_{ℓ∈S} N(i-ℓ)`. This is a constant-coefficient linear recurrence; multiplying by `xⁱ` and summing gives `F(x)(1 − Σ_{ℓ∈S} x^ℓ) = 1`, i.e. `F(x) = 1/(1 − Σ_{ℓ∈S} x^ℓ)`. ∎

**Corollary 4.4 (Compositions).** For `S = {1, 2}` (`D = {a, aa}`), `F(x) = 1/(1 − x − x²)`, the Fibonacci generating function, so `N(n) = F_{n+1}` (Fibonacci). For `S = {1, 2, …, k}`, `N(n)` counts compositions of `n` into parts `≤ k`; for `S = {1, 2, 3, …}` (all run lengths), `N(n) = 2^{n-1}` (the number of compositions of `n`). These closed forms exhibit the exponential growth rate explicitly.

### 4.1 Worked Counting Example

For `s = "aaaa"` and `D = {a, aa}` (so `S = {1, 2}`):

```
N(0) = 1
N(1) = N(0)              = 1          (only "a")
N(2) = N(1) + N(0)       = 1 + 1 = 2  ("a a", "aa")
N(3) = N(2) + N(1)       = 2 + 1 = 3
N(4) = N(3) + N(2)       = 3 + 2 = 5
```

`N(4) = 5 = F_5`, matching Corollary 4.4. The five segmentations are
`a a a a`, `aa a a`, `a aa a`, `a a aa`, `aa aa` — exactly the compositions of `4` into parts `1` and `2`. The recurrence `N(i) = N(i-1) + N(i-2)` is visible in the table: a segmentation of `aaaa` ends in either a final `"a"` (after a segmentation of `aaa`) or a final `"aa"` (after a segmentation of `aa`).

### 4.2 Asymptotic Growth Rate

The dominant root of the denominator `1 − Σ_{ℓ∈S} x^ℓ` controls the growth. For `S = {1,2}` the denominator `1 − x − x²` has reciprocal-roots `φ` and `ψ`, so `N(n) = Θ(φⁿ)` with `φ ≈ 1.618`. In general, by the standard transfer theorem of analytic combinatorics, `N(n) ∼ C · ρ^{-n}` where `ρ` is the smallest positive root of `1 − Σ_{ℓ∈S} x^ℓ = 0`, and `ρ^{-1}` is the largest reciprocal-root. This `ρ^{-1}` is precisely the spectral radius (Perron eigenvalue) of the segmentation automaton's transfer matrix (Corollary 8.3) — the same `λ_max` that governs walk-count growth in the sibling `paths-fixed-length` topic. The exponential growth is therefore not an artifact of a particular dictionary; it is the generic behavior whenever more than one run length is allowed.

---

## 5. Why Word Break II Is Exponential: Worst-Case Sentence Counts

**Theorem 5.1 (Exponential output lower bound).** There is a family of instances `(s_n, D)` with `|s_n| = n` and `|D| = O(1)` for which the number of segmentations is `Θ(φⁿ)` (`φ = (1+√5)/2 ≈ 1.618`), and hence `WORD-BREAK-ALL` requires `Ω(φⁿ)` output operations.

**Proof.** Take `s_n = aⁿ`, `D = {a, aa}`. By Corollary 4.4, `N(n) = F_{n+1}`, and `F_{n+1} = Θ(φⁿ)` by Binet's formula `F_m = (φ^m − ψ^m)/√5` with `|ψ| < 1`. Each segmentation is a distinct output object of size `Ω(1)` (in fact `Ω(n)` characters when written as a sentence), so listing them all forces `Ω(φⁿ)` work — and `Ω(n·φⁿ)` when each sentence is written in full. ∎

**Theorem 5.2 (Sharpest blow-up).** For `s = aⁿ` and `D = {a, aa, aaa, …, aⁿ}` (every run length), `N(n) = 2^{n-1}`.

**Proof.** By Corollary 4.4 with `S = {1, …, n}`, `N(n)` is the number of compositions of `n`, which is `2^{n-1}` (each of the `n-1` internal gaps is independently a cut or not). ∎

**Growth comparison table.** The blow-up depends sharply on the dictionary:

| `s = aⁿ`, `D` | `N(n)` | growth |
|---------------|--------|--------|
| `{a}` | `1` | constant |
| `{a, aa}` | `F_{n+1}` | `Θ(φⁿ)`, `φ ≈ 1.618` |
| `{a, aa, aaa}` | Tribonacci | `Θ(1.839ⁿ)` |
| `{a, aa, …, aⁿ}` (all) | `2^{n-1}` | `Θ(2ⁿ)` |

Each added run length raises the dominant root `ρ^{-1}` of `1 − Σ x^ℓ`, pushing the growth rate toward `2`. The progression `1.618 → 1.839 → … → 2` is the spectral-radius sequence of the corresponding transfer matrices (Section 4.2). No dictionary on a single letter exceeds `2ⁿ`, because `2^{n-1}` already counts *all* compositions.

**Consequence (output-sensitivity).** WB-II's complexity is intrinsically `Ω(output size)`, which is exponential. No algorithm avoids this; the best possible is **output-sensitive** time `O(P(n) + total output size)` for a polynomial `P` (the DP overhead). The standard memoized backtracking achieves this, provided dead branches are pruned so that *only* states contributing to some output are explored — otherwise an instance like `aⁿ⁻¹ b` with `D = {a, aa, …}` (no completion) does exponential work for **zero** output. Pruning with the reachability predicate `seg'(i)` ("is `s[i..n)` segmentable?") restores the output-sensitive bound.

**The dead-branch pathology, concretely.** Consider `s = "aaaab"` with `D = {a, aa}` (no word covers the trailing `b`). Without pruning, backtracking from position 0 explores the exponentially many ways to segment the `"aaaa"` prefix, each of which then hits the dead `b` and produces nothing:

```
# UNPRUNED: explores F_5 = 5 prefix splits, all of which fail at 'b' -> 0 output, wasted work
# PRUNED:  canReachEnd[4] = false (b unsegmentable), so position 4 is never entered
#          -> the whole search is cut at the root, O(n) instead of O(F_n)
```

The reachability array `seg'(i)` is itself computed by one `O(n·L)` Word Break pass on suffixes. With it, every recursive call provably lies on a real root-to-`n` path, charging all work to actual output (Theorem 10.3). This is the formal justification for the "decide first, then enumerate" discipline of the senior level.

**Theorem 5.3 (Counting is exponentially easier than enumerating).** `#WORD-BREAK` is solvable in polynomial time `O(n·L)` (Theorem 4.2), whereas `WORD-BREAK-ALL` requires exponential time in the worst case (Theorem 5.1). Thus counting and enumerating are separated by an exponential gap.

**Proof.** Immediate from Theorem 4.2 (polynomial counting) and Theorem 5.1 (exponential enumeration). The gap is the same phenomenon as "counting lattice paths is easy, listing them is hard": the count is a single number satisfying a polynomial recurrence, while the objects themselves are exponentially numerous. ∎

---

## 6. The Segmentation Semiring: One DP, Many Outputs

The recurrences of Sections 2 and 4 share a structure: `value(i) = ⊕_{j} ( [s[j..i)∈D] ⊗ value(j) )`. Abstracting `(⊕, ⊗)` into a **semiring** unifies all Word Break variants.

**Definition 6.1.** A semiring `(K, ⊕, ⊗, 0̄, 1̄)` has commutative monoid `(K, ⊕, 0̄)`, monoid `(K, ⊗, 1̄)`, distributivity, and annihilation `a ⊗ 0̄ = 0̄`. Define the **Word Break value** by `val(0) = 1̄` and `val(i) = ⊕_{j<i} ( edge(j,i) ⊗ val(j) )`, where `edge(j,i) = 1̄` if `s[j..i) ∈ D` and `0̄` otherwise (a weighted variant lets `edge` carry a word score).

| Semiring | `⊕` | `⊗` | `0̄` | `1̄` | `val(n)` means |
|----------|-----|-----|-----|-----|----------------|
| Boolean | `∨` | `∧` | `false` | `true` | is `s` segmentable? (WB-I) |
| Counting `(ℕ, +, ×)` | `+` | `×` | `0` | `1` | number of segmentations (#WB) |
| Min-plus (fewest words) | `min` | `+` (each word cost 1) | `+∞` | `0` | minimum #words to segment |
| Max-plus (most words) | `max` | `+` | `−∞` | `0` | maximum #words to segment |
| Viterbi (max-probability) | `max` | `+` (log-probs) | `−∞` | `0` | best-scoring segmentation |
| Free / list | set-union | prepend-word | `∅` | `{ε}` | the set of all segmentations (WB-II) |

**Proposition 6.2.** For any semiring `K`, the recurrence `val(i) = ⊕_{j<i}(edge(j,i) ⊗ val(j))` is well-defined and computable in `O(n·L)` semiring operations, because the dependency graph is a DAG (`val(i)` depends only on `val(j)` with `j<i`), so a single left-to-right pass evaluates it.

**Proof.** Topologically order the subproblems by index `0 < 1 < … < n`. The recurrence references only strictly smaller indices, so processing in increasing order has all operands ready (this is the algebraic restatement of Theorem 2.2). Each `val(i)` is `≤ L` semiring `⊗` and `⊕` operations. ∎

This is the precise sense in which "the same DP" answers decide / count / shortest / best / all — only `(⊕, ⊗)` and the element type change. The **list semiring** is non-idempotent and unbounded (its elements are sets of sentences whose size can be exponential), which is exactly why WB-II escapes polynomiality while the others stay polynomial: the boolean and counting semirings have `O(1)`-size elements, the list semiring does not.

### 6.1 Idempotency and Element Size

Two algebraic properties partition the semirings by behavior:

- **Idempotency** (`a ⊕ a = a`): the Boolean, min-plus, and max-plus semirings are idempotent. This is what makes "fewest words" and "is it segmentable" stabilize — adding a redundant witness changes nothing. The counting semiring is **not** idempotent (`1 + 1 = 2`), which is precisely why the count *grows* rather than saturating.
- **Element size**: Boolean (`1` bit), counting (`O(n)`-digit integer), min/max-plus (`O(log n)`-bit number), and Viterbi (`O(n)`-bit log-probability) all have *polynomially bounded* element representations, so each semiring operation is polynomial and the whole DP is polynomial. The **list** semiring's elements are sets of up to `Θ(φⁿ)` sentences — *exponentially* large — so even a single `⊕` (set union) can be exponential.

**Proposition 6.3.** A Word Break variant over semiring `K` runs in polynomial time iff the representation of every reachable `val(i)` is polynomially bounded and `⊕, ⊗` are polynomial-time on those representations. Decide, count (mod `p` or big-int), fewest/most words, and Viterbi all satisfy this; full enumeration does not.

**Proof.** The DP performs `O(n·L)` semiring operations (Proposition 6.2). If each operates on polynomial-size operands in polynomial time, the total is polynomial. Conversely, if some `val(i)` has super-polynomial representation (as the list semiring's does, by Theorem 5.1), merely writing it down is super-polynomial. ∎

This is the cleanest formal explanation of the count/enumerate gap: it is a statement about *element size in the semiring*, not about cleverness.

---

## 7. Top-Down vs Bottom-Up: Equivalence and Cost

**Theorem 7.1 (Equivalence).** The bottom-up tabulation of Theorem 2.2 and the top-down memoized recursion `canBreak(i) = (i=n) ∨ ∃ end>i : s[i..end)∈D ∧ canBreak(end)` compute the same predicate and perform the same set of distinct subproblem evaluations, hence the same `O(n·L)` work.

**Proof.** Both evaluate each of the `n+1` subproblems exactly once: tabulation by construction, memoization because the cache prevents recomputation. The recurrences are the prefix (`seg(i)`) and suffix (`canBreak(i)`) formulations, related by reversing the string; they are isomorphic. The per-subproblem work (`≤ L` membership tests) is identical. ∎

**Difference in *which* subproblems.** Top-down evaluates only subproblems **reachable** from the root call; bottom-up evaluates **all** `n+1`. For WB-I this rarely matters (the cap makes both `O(n·L)`), but for sparse instances top-down can skip unreachable indices. The cost asymmetry is a constant factor, not an asymptotic one.

**Stack depth.** Top-down recursion has depth `O(n)`; for adversarial `n` this can overflow the call stack, a practical (not asymptotic) failure mode that bottom-up avoids. Conversely, top-down is the natural and clearer formulation for the **list semiring** (WB-II), where the recursion tree mirrors the sentence structure.

### 7.1 The Two Formulations Side by Side

The prefix and suffix formulations are mirror images:

```
Bottom-up (prefix):  dp[0] = ⊤
                     dp[i] = ⋁_{j<i} ( dp[j] ∧ [s[j..i)∈D] ),   answer dp[n]

Top-down (suffix):   can(n) = ⊤
                     can(i) = ⋁_{e>i} ( [s[i..e)∈D] ∧ can(e) ),  answer can(0)
```

**Lemma 7.2.** `dp[i] = seg(i)` and `can(i) = seg'(i)` where `seg'(i)` = "is `s[i..n)` segmentable?". The two predicates are related by `seg(i)` over the original string equalling `seg'(n-i)` over the *reversed* string with the reversed dictionary. They compute the same decision `seg(n) = seg'(0)`.

**Proof.** Reversing `s` and every word in `D` turns a prefix into a suffix and preserves membership (`w ∈ D ⟺ reverse(w) ∈ reverse(D)`). Under this involution the prefix recurrence maps exactly to the suffix recurrence, and `seg(n)` maps to `seg'(0)`. ∎

This is why an interviewer accepting either formulation is correct: they are the same DP under string reversal, with identical `O(n·L)` cost and the same set of `n+1` subproblems.

---

## 8. The DFA / Regular-Language Connection

**Theorem 8.1.** `s` is segmentable by `D` iff `s ∈ D*` (the Kleene star of `D`). Since `D` is finite, `D*` is a **regular language**, recognized by a finite automaton.

**Proof.** `D*` is by definition the set of finite concatenations of words in `D`, which is exactly the set of segmentable strings (Definition 1.1). A finite `D` is regular, and regular languages are closed under Kleene star, so `D*` is regular and has a recognizing DFA (e.g., build an NFA with a start state, the Trie of `D` from it, ε-back-edges from each word-end to the start, then determinize). ∎

**Corollary 8.2 (WB-I as DFA acceptance).** Running `s` through a DFA for `D*` decides WB-I in `O(n)` after an `O(2^{‖D‖})`-worst-case (usually far smaller) preprocessing to build the DFA. The Trie-with-failure-links (Aho-Corasick) over `D`, with the back-edges above, is a concrete realization: the prefix DP `dp[i]` corresponds to "is the automaton in an accepting state after reading `s[0..i)`", and the Trie walk is the automaton's transition function.

**Corollary 8.3 (Counting via the transfer matrix).** Let `M` be the transition-count matrix of the segmentation automaton (states = automaton states, `M[u][v]` = number of single-character transitions `u → v`). Then `#WB` for `s = aⁿ` (single-letter alphabet) is read off `(Mⁿ)[start][accept]`, connecting #WB to the matrix-exponentiation walk-counting of the sibling topic `paths-fixed-length`: the generating function `Σ N(n) xⁿ = 1/(1 − Σ_{ℓ∈S} x^ℓ)` (Theorem 4.3) is exactly `(I − xM)^{-1}` restricted to the relevant entry. The rationality of the generating function is the algebraic statement that `D*` is regular.

**Generalization to regex tokenization.** Replacing the literal dictionary `D` with a set of *regular expressions* (token patterns) generalizes Word Break to **maximal-munch lexing**: the DFA is built from the union of pattern automata, and the DP/automaton walk segments `s` into tokens. Word Break is the literal-set special case; the Trie/Aho-Corasick is the literal-set analogue of the lexer's DFA.

### 8.1 Worked DFA Example

Let `D = {"a", "aa"}` over alphabet `{a}`. The Kleene star `D* = {a}* \ {ε}` plus `ε` — i.e. every string of `a`s is segmentable (including the empty string). A minimal DFA for `D*` over `{a}` therefore has a single accepting state with an `a`-self-loop: after reading any number of `a`s you are accepting. The prefix DP `dp[i] = ⊤` for all `i` reflects exactly this — `aⁿ` is always segmentable by `{a}`.

A less trivial case: `D = {"ab", "b"}`, `s = "abb"`. The segmentation automaton (Trie of `D` with ε-back-edges from each word-end to start) accepts a string iff it factors into `ab` and `b`:

```
seg(0)=⊤
seg(1): "a"      ∉ D                        → ⊥
seg(2): "ab" ∈ D ∧ seg(0)                   → ⊤
seg(3): "b"  ∈ D ∧ seg(2)                   → ⊤   ("ab" · "b")
```

`s = "abb"` is accepted: `dp[3] = ⊤`, witness chain `3 → 2 → 0`. The DP is the automaton's run, with `dp[i]` = "is the automaton in an accepting (start-equivalent) state after reading `s[0..i)`".

### 8.2 Transfer-Matrix Count for the Single-Letter Case

```python
# #WB for s = a^n, D = {a, aa}, via the 1/(1 - x - x^2) recurrence == Fibonacci.
def count_unary(n, run_lengths):
    """Number of segmentations of a^n using a^ℓ for ℓ in run_lengths."""
    S = set(run_lengths)
    N = [0] * (n + 1)
    N[0] = 1
    for i in range(1, n + 1):
        for ell in S:
            if i - ell >= 0:
                N[i] += N[i - ell]
    return N[n]


# count_unary(4, [1, 2]) == 5  (Fibonacci F_5)
# count_unary(5, [1, 2, 3]) == 13 (Tribonacci-style)
```

The recurrence `N(i) = Σ_{ℓ∈S} N(i-ℓ)` is precisely the entry `(Mⁱ)[start][accept]` of the transfer matrix `M` raised to the `i`-th power, linking #WB to the matrix-exponentiation walk count of sibling `paths-fixed-length`. The generating function `1/(1 − Σ_{ℓ∈S} x^ℓ)` is the formal-power-series form of `(I − xM)^{-1}` restricted to that entry.

---

## 9. The Segmentation Lattice as a DAG

**Definition 9.1 (Segmentation DAG).** Build a directed graph `G_s` on vertices `{0, 1, …, n}` with an edge `j → i` labeled `s[j..i)` whenever `s[j..i) ∈ D`. Then:

- **WB-I** = "is there a path `0 ⇝ n`?" (reachability).
- **WB-II** = "enumerate all paths `0 ⇝ n`" (path listing).
- **#WB** = "count paths `0 ⇝ n`" (path counting in a DAG).
- **Fewest words** = "shortest path `0 ⇝ n`" (each edge weight 1).
- **Best segmentation** = "max-weight path" (edge weight = word score).

**Theorem 9.2.** `G_s` is a DAG (all edges go `j → i` with `j < i`), with `O(n)` vertices and `O(n·L)` edges. All five problems above are the corresponding standard DAG problems, solvable by the single topological-order DP of Proposition 6.2 — except path *enumeration*, which is exponential in the number of paths.

**Proof.** Edges strictly increase the index, so no cycle exists: `G_s` is a DAG. Edge count: each vertex `i` has `≤ L` incoming edges (from `j ∈ [i-L, i)`), so `≤ n·L` total. Counting/shortest/longest/reachability in a DAG are linear in `|V|+|E| = O(n·L)` by DP over the topological order. Path enumeration is `Ω(#paths)`, which Theorem 5.1 shows can be `Θ(φⁿ)`. ∎

**The lattice as compact output.** The DAG `G_s` is a **polynomial-size representation of all (exponentially many) segmentations** — a "word lattice". Instead of materializing every sentence, production NLP pipelines pass this `O(n·L)`-size DAG downstream, where a scorer extracts the best path(s) without enumerating all of them. This is the principled escape from Theorem 5.1: you cannot list all segmentations in polynomial time, but you can *represent* them in polynomial space and answer count/shortest/best queries on the representation in polynomial time.

### 9.1 Worked Lattice Example

For `s = "catsanddog"` (indices `0..10`: `c(0) a(1) t(2) s(3) a(4) n(5) d(6) d(7) o(8) g(9)`) and `D = {cat, cats, and, sand, dog}`, the dictionary matches (edges `j → i` labeled `s[j..i)`) are:

```
0 → 3   "cat"     (s[0..3))
0 → 4   "cats"    (s[0..4))
4 → 7   "and"     (s[4..7))
3 → 7   "sand"    (s[3..7))
7 → 10  "dog"     (s[7..10))
```

The DAG `G_s` therefore has exactly two complete paths `0 ⇝ 10`:

```
Path A:  0 →"cat"→ 3 →"sand"→ 7 →"dog"→ 10     ⇒  "cat sand dog"
Path B:  0 →"cats"→ 4 →"and"→ 7 →"dog"→ 10     ⇒  "cats and dog"
```

Both reach vertex `10`, so `seg(10) = ⊤`. The lattice makes the structure explicit: `#WB = 2` (count paths), fewest-words `= 3` (both paths have length 3), and any best-scoring query is a max-weight path — all computed in one `O(n·L)` topological pass over this single `O(n·L)`-edge DAG, found once and reused. Only *listing* the paths is exponential in general; here there happen to be just two.

### 9.2 Why the DAG Beats Re-Enumeration

Building `G_s` is `O(n·L)`. Once built:

| Query | DAG operation | Cost |
|-------|---------------|------|
| Segmentable? | reachability `0 ⇝ n` | `O(n·L)` |
| How many segmentations? | count paths (topological DP) | `O(n·L)` |
| Fewest / most words | shortest / longest path | `O(n·L)` |
| Best-scoring | max-weight path | `O(n·L)` |
| First `K` segmentations | `K`-shortest paths / DFS with cap | `O(n·L + K·n)` |
| All segmentations | enumerate all paths | `Ω(#paths)` exponential |

The lattice amortizes the structure across queries: ask many questions about the same string's segmentations without recomputing the matches. This is exactly the production discipline of building the structure once and querying it many ways.

---

## 10. Lower Bounds and Relationships

**Theorem 10.1 (WB-I is in `P`, indeed near-linear).** WB-I ∈ `P` with `O(n·L)` time (Theorem 3.1), and `Ω(n)` is a trivial lower bound (Theorem 3.2). For constant `L` it is `Θ(n)`.

**Membership in the complexity hierarchy.** WB-I is decidable by a DFA for `D*` (Theorem 8.1), placing it in the regular languages and hence in `NC¹` (and in `L`, logarithmic space) for a *fixed* dictionary: a constant-size automaton reads `s` once. When `D` is part of the input, the relevant bound is the `O(n·L)` of Theorem 3.1. This is far below the `NP`/`#P` ceiling that simple-path problems hit — Word Break is genuinely easy, not merely "polynomial".

**Theorem 10.2 (#WB is in `FP`).** Counting segmentations is in `FP` (polynomial-time computable function) via Theorem 4.2 — `O(n·L)` arithmetic operations, polynomial even with big-integer arithmetic (each integer has `O(n)` digits, total `O(n²·L/ wordsize)`). This is in sharp contrast to #P-hard counting problems (e.g. counting simple paths of a given length in a general graph): #WB is easy because its DAG `G_s` is acyclic and its subproblems are memoryless.

**Comparison with simple-path counting.** The sibling topic `paths-fixed-length` notes that counting *walks* of length `k` is polynomial while counting *simple paths* is #P-hard, the difference being the memoryless property. Word Break's DAG counting is the easy (memoryless) case: each `N(i)` depends only on the index `i`, not on which words were used to reach it. There is no "visited set" to track, so no exponential state — #WB is in `FP`, never #P-hard.

**Why memorylessness holds for Word Break.** The crucial structural fact is that the segmentation DAG `G_s` is **acyclic** (edges strictly increase the index) and the count at a vertex is independent of the path taken to reach it:

```
# Counting in a DAG is a single topological-order pass — no visited set.
def count_dag_paths(s, dict_set, max_len):
    n = len(s)
    N = [0] * (n + 1)
    N[0] = 1
    for i in range(1, n + 1):                 # topological order 0,1,...,n
        for j in range(max(0, i - max_len), i):
            if s[j:i] in dict_set:
                N[i] += N[j]                  # accumulate, no state about HOW
    return N[n]
```

Contrast counting simple paths of length `k` in a general (possibly cyclic) graph: the count at a vertex *does* depend on which vertices were already visited, forcing a `2^V`-subset state (the Bellman-Held-Karp DP). That non-locality is exactly what pushes simple-path counting into #P-hardness. Word Break has neither cycles nor a visited-set constraint, so it stays in `FP`. The line `N[i] += N[j]` carries no information about the route — the defining feature of a memoryless DP.

**Theorem 10.3 (WB-II output bound is tight).** Memoized backtracking with reachability pruning lists all segmentations in `O(n·L + total output size)`, matching the `Ω(output size)` lower bound (Theorem 5.1) up to the polynomial DP overhead. Hence WB-II is **optimal among output-sensitive algorithms**.

**Proof.** The DP overhead (computing reachability and the DAG) is `O(n·L)`. With pruning, every recursive call lies on at least one root-to-`n` path, so the work charged to enumeration is proportional to the number and length of output sentences. ∎

### 10.1 Bit-Complexity of Exact Counting

The arithmetic-operation count of `#WB` is `O(n·L)`, but the *bit* complexity must account for the growing integers. By Section 4.2, `N(i) = Θ(ρ^{-i})`, so `N(n)` has `Θ(n · log(ρ^{-1})) = Θ(n)` bits. Each addition `count[i] += count[j]` operates on `O(n)`-bit numbers in `O(n / w)` machine-word operations (`w` = word size). Summing over `O(n·L)` additions gives:

**Theorem 10.4 (Exact-count bit-complexity).** `#WB` with exact big-integer arithmetic runs in `O(n² · L / w)` word operations — polynomial, but a factor of `Θ(n / w)` slower than the modular count. The modular count (reducing mod a fixed-width prime) restores `O(1)` per addition and hence `O(n·L)` overall.

**Proof.** Each of the `O(n·L)` recurrence additions adds two integers of `O(n)` bits, costing `O(n / w)`. The total is `O(n·L · n / w) = O(n²·L/w)`. With a fixed prime modulus, every intermediate is `< p < 2^w`, so additions and reductions are `O(1)`. ∎

**Corollary 10.5 (Modular homomorphism).** The reduction `φ_p : ℤ → ℤ_p` is a ring homomorphism, so `φ_p` commutes with the counting recurrence: computing `count[i] mod p` at every step yields exactly `N(n) mod p`. Running under several coprime primes and recombining by CRT recovers `N(n)` exactly whenever `N(n) < ∏ pₖ`, with each prime an independent `O(n·L)` pass — the same CRT pipeline used in the sibling matrix-exponentiation topic.

### 10.2 Relationship to Restricted Compositions

`#WB` for `s = aⁿ` with run-length set `S` is exactly the number of **compositions of `n` with parts in `S`** — a classical combinatorial quantity with generating function `1/(1 − Σ_{ℓ∈S} x^ℓ)` (Theorem 4.3). General Word Break (non-uniform string) is a *string-constrained* generalization: not every composition is realizable, only those whose parts spell dictionary words at the right offsets. This places `#WB` between two classical objects: unrestricted compositions (`S = ℤ⁺`, count `2^{n-1}`) and the path-counting of a DAG (the lattice of Section 9). The realizability constraint is what makes the general problem string-dependent while keeping it polynomial.

---

## 11. Summary

- **Recurrence & correctness.** `seg(i) ⟺ (i=0) ∨ ∃j<i (seg(j) ∧ s[j..i)∈D)`, proved by the last-word bijection. Optimal substructure (a segmentation = shorter segmentation + one word) and overlapping subproblems (`n+1` shared states) make DP applicable; the empty prefix `seg(0)=⊤` is the forced base case.
- **Complexity.** WB-I is `O(n·L·C)`; with a Trie the per-check cost `C` drops to amortized `O(1)` with no substring allocation, giving `O(n·L)`, within an `O(L)` factor of the `Ω(n)` lower bound.
- **Counting.** `#WB` satisfies the same recurrence with `(∨,⊤) ↦ (+,1)`, solvable in `O(n·L)` (`FP`); for `s=aⁿ` the count has generating function `1/(1−Σ_{ℓ∈S}x^ℓ)` — Fibonacci for `{a,aa}`, `2^{n-1}` for all run lengths.
- **WB-II exponential.** The number of segmentations is `Θ(φⁿ)` (and up to `2^{n-1}`), so enumeration is intrinsically exponential; the best achievable is output-sensitive `O(n·L + output)`, requiring reachability pruning to avoid wasted work on dead branches.
- **Semiring unification.** Boolean (decide), counting (#WB), min/max-plus (fewest/most words), Viterbi (best score), and list (all sentences) are one recurrence over different semirings; the list semiring's unbounded element size is *why* WB-II alone escapes polynomiality.
- **Top-down vs bottom-up.** Equivalent `O(n·L)` work on the same subproblems; bottom-up is stack-safe and cache-friendly for the boolean/counting versions, top-down is natural for the list version.
- **Automaton / regex connection.** `s` is segmentable iff `s ∈ D*`, a regular language; the Trie-with-back-edges (Aho-Corasick) realizes its DFA, and the rational generating function reflects regularity. The literal-dictionary case generalizes to regex maximal-munch lexing.
- **Lattice DAG.** `G_s` (vertices `0..n`, edges = dictionary matches) is a polynomial-size DAG encoding all segmentations; decide/count/shortest/best are standard DAG DPs on it, while enumeration is the exponential path-listing case — the DAG is the compact escape used in production.

### Complexity Cheat Table

| Task | Semiring | Complexity | Class |
|------|----------|-----------|-------|
| Decide segmentable (WB-I) | `(∨, ∧)` | `O(n·L)` | `P` (near-linear) |
| Count segmentations (#WB) | `(+, ×)` mod `p` | `O(n·L)` | `FP` |
| Fewest / most words | `(min,+)` / `(max,+)` | `O(n·L)` | `P` |
| Best-scoring (Viterbi) | `(max, +)` log-probs | `O(n·L)` | `P` |
| One segmentation | parent pointers | `O(n·L)` build, `O(n)` reconstruct | `P` |
| All segmentations (WB-II) | free/list | `O(n·L + output)`, output `Θ(φⁿ)` worst | output-sensitive |

### Worked End-to-End Trace

Pulling the threads together on `s = "applepie"`, `D = {apple, pie, pen}`:

```
decide  (WB-I):   seg(8) = ⊤ via 8→5 "pie", 5→0 "apple"   ⇒ segmentable
count   (#WB):    N(8) = 1                                  ⇒ exactly one segmentation
fewest words:     2  ("apple" "pie")
lattice G_s:      edges 0→5 "apple", 5→8 "pie"  (one path 0⇝8)
enumerate (WB-II): ["apple pie"]                            ⇒ output size 1, no blow-up
```

Every variant reads off the *same* DAG: decide is reachability, count is path-counting, fewest-words is shortest-path, enumerate is path-listing. The unity is the entire point of the semiring and lattice views — one structure, computed once, answers every question, and only enumeration risks the exponential of Section 5.

### Closing Notes

- **Optimal substructure** (Section 2) is the precise reason a one-dimensional prefix DP suffices: the subproblem `seg(j)` is independent of *how* `s[0..j)` is segmented.
- **The counting/enumeration gap** (Sections 4–5): a polynomial recurrence computes the count of an exponential family — count first, enumerate only when safe.
- **The semiring view** (Section 6) shows all variants are one algorithm; the bounded vs unbounded element size cleanly explains which variants are polynomial.
- **The DAG/automaton view** (Sections 8–9) connects Word Break to regular languages, transfer matrices, and the polynomial-size lattice that represents exponentially many segmentations compactly.

Foundational references: any DP text (CLRS, dynamic-programming chapter) for optimal substructure; Aho-Corasick (1975) for the dictionary automaton; Flajolet-Sedgewick (*Analytic Combinatorics*, Ch. V) for the transfer-matrix method and rational generating functions of regular languages; Hopcroft-Ullman for `D*` regularity and DFA construction; the Viterbi algorithm for max-probability segmentation. Sibling topics: `string-algorithms`, `tree-traversals` (Trie), `paths-fixed-length` (transfer matrices / DAG path counting), and `dynamic-programming`.

### Cross-Topic Connections

- `paths-fixed-length` — the transfer matrix of the segmentation automaton; `#WB` on `aⁿ` is `(Mⁿ)[start][accept]`.
- `tree-traversals` — the Trie that realizes the dictionary automaton's transition function.
- `string-algorithms` — Aho-Corasick, KMP failure links, and the maximal-munch lexing generalization.
- `dynamic-programming` — optimal substructure and overlapping subproblems, of which Word Break is a clean exemplar.

### One-Paragraph Takeaway

Word Break is the canonical *acyclic, memoryless* DP: a prefix predicate `seg(i)` built by a last-word bijection, provably correct by a one-line induction, polynomial because there are only `n+1` subproblems and each has `O(1)`-size value. Every variant — decide, count, fewest/most words, best-scoring, all sentences — is the same recurrence over a different semiring, and all but enumeration stay polynomial precisely because their semiring elements stay polynomially sized. The string `s` is segmentable iff `s ∈ D*` (a regular language), so the whole topic sits comfortably inside `P` (indeed near-linear), in stark contrast to the #P-hardness that appears the moment a "no-repeats" or "exact simple path" constraint destroys memorylessness.
